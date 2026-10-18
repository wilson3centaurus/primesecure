-- Inventory stays metadata + bounded previews. Originals exist here ONLY after
-- an authorized request. 24h access expiry, hourly/daily Storage API cleanup.
create schema device_media_private;
revoke all on schema device_media_private from public, anon;
grant usage on schema device_media_private to authenticated;

-- Preserve command types installed by other feature migrations.
do $$ declare existing text; begin
 select pg_get_expr(conbin,conrelid) into strict existing from pg_constraint
 where conrelid='public.commands'::regclass and conname='commands_type_check';
 alter table public.commands drop constraint commands_type_check;
 execute 'alter table public.commands add constraint commands_type_check check (type = ''retrieve_file'' OR (' || existing || '))';
end $$;

create table public.device_file_transfers (
 id uuid primary key default gen_random_uuid(),
 -- Keep cleanup pointers if a school/device is deleted before expiry. Access
 -- helpers require the live matching device, so detached originals are unreadable.
 school_id uuid references public.schools(id) on delete set null,
 device_id uuid references public.devices(id) on delete set null,
 requested_by uuid references auth.users(id) on delete set null,
 command_id uuid unique references public.commands(id) on delete set null,
 path text not null, filename text not null,
 expected_size bigint not null check(expected_size between 0 and 500000000),
 expected_modified bigint not null check(expected_modified>=0),
 storage_path text unique not null,
 created_at timestamptz not null default now(),
 expires_at timestamptz not null default now()+interval '24 hours',
 completed_at timestamptz, cleaned_at timestamptz,
 check(expires_at<=created_at+interval '24 hours')
);
create index device_file_transfers_expiry on public.device_file_transfers(expires_at) where cleaned_at is null;
create index device_file_transfers_device_time on public.device_file_transfers(device_id,created_at desc);
alter table public.device_file_transfers enable row level security;
revoke all on public.device_file_transfers from public,anon,authenticated;
grant select on public.device_file_transfers to authenticated;
grant all on public.device_file_transfers to service_role;
create policy device_file_transfers_read on public.device_file_transfers for select to authenticated
 using (coalesce(public.can_manage_school(school_id),false));

insert into storage.buckets(id,name,public,file_size_limit)
 values('device-file-originals','device-file-originals',false,500000000);

create function device_media_private.safe_path(p text) returns boolean
language sql immutable set search_path='' as $$
 select coalesce(length(p) between 1 and 1000 and p !~ '(^/|\\|:|[[:cntrl:]])'
 and p !~ '(^|/)(\.|\.\.|\.[^/]*)(/|$)' and p !~ '//'
 and p !~ '/$' and p !~* '^(@usb/[^/]+/)?Android(/|$)'
 and (p !~ '^@' or p ~ '^@usb/[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}/.+'),false)
$$;

create function device_media_private.request_original(p_device_id uuid,p_path text,p_size bigint,p_modified bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare d public.devices; entry jsonb; r public.device_file_transfers; cid uuid; rid uuid:=gen_random_uuid();
begin
 select * into d from public.devices where id=p_device_id for update;
 if auth.uid() is null or d.id is null or not coalesce(public.can_manage_school(d.school_id),false)
 then raise exception 'School administrator required' using errcode='42501'; end if;
 if d.status in ('pending','retired') then raise exception 'Device is not enrolled'; end if;
 if not device_media_private.safe_path(p_path) or p_size is null or p_modified is null
 then raise exception 'Invalid shared-storage file'; end if;
 select e into entry from public.device_file_cache c,jsonb_array_elements(c.snapshot->'entries') e
 where c.device_id=d.id and e->>'path'=p_path and e->>'dir'='false' limit 1;
 if entry is null then raise exception 'File absent from cached inventory. Refresh the inventory first.'; end if;
 if p_size is distinct from (entry->>'size')::bigint or p_modified is distinct from (entry->>'modified')::bigint
 then raise exception 'File metadata changed. Refresh the inventory first.'; end if;
 if p_size not between 0 and 500000000 then raise exception 'Original must be at most 500 MB'; end if;
 -- Repeated clicks and lost responses reuse one transfer, rather than reupload.
 select t.* into r from public.device_file_transfers t left join public.commands c on c.id=t.command_id
 where t.device_id=d.id and t.path=p_path and t.expected_size=p_size and t.expected_modified=p_modified
 and t.expires_at>now() and t.cleaned_at is null and (t.completed_at is not null or c.status in ('pending','delivered'))
 order by t.created_at desc limit 1;
 if r.id is not null then return jsonb_build_object('request_id',r.id,'command_id',r.command_id,'expires_at',r.expires_at); end if;
 if (select count(*) from public.device_file_transfers where device_id=d.id and created_at>now()-interval '24 hours')>=100
 then raise exception 'Daily original-file request limit reached (100 per device)'; end if;
 if (select count(*) from public.device_file_transfers t join public.commands c on c.id=t.command_id
 where t.device_id=d.id and t.expires_at>now() and t.completed_at is null and c.status in ('pending','delivered'))>=10
 then raise exception 'Wait for pending original-file requests (10 per device)'; end if;
 insert into public.commands(device_id,school_id,type,payload,created_by)
 values(d.id,d.school_id,'retrieve_file',jsonb_build_object('request_id',rid),auth.uid()) returning id into cid;
 insert into public.device_file_transfers(id,device_id,school_id,requested_by,command_id,path,filename,expected_size,expected_modified,storage_path)
 values(rid,d.id,d.school_id,auth.uid(),cid,p_path,entry->>'name',p_size,p_modified,d.school_id::text||'/'||d.id::text||'/'||rid::text||'/original');
 return jsonb_build_object('request_id',rid,'command_id',cid,'expires_at',now()+interval '24 hours');
end $$;

create function device_media_private.device_ticket(p_request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.device_file_transfers;
begin
 select t.* into r from public.device_file_transfers t join public.devices d on d.id=t.device_id
 join public.commands c on c.id=t.command_id
 where t.id=p_request_id and t.device_id=public.current_device_id() and d.auth_user_id=auth.uid()
 and d.school_id=t.school_id and d.status not in ('pending','retired') and t.expires_at>now() and t.cleaned_at is null
 and c.type='retrieve_file' and c.payload->>'request_id'=t.id::text and c.status in ('pending','delivered','succeeded');
 if auth.uid() is null or r.id is null then raise exception 'Transfer unavailable for this device' using errcode='42501'; end if;
 return jsonb_build_object('request_id',r.id,'path',r.path,'size',r.expected_size,'modified',r.expected_modified,
 'bucket','device-file-originals','storage_path',r.storage_path,'expires_at',r.expires_at,'ready',r.completed_at is not null,
 'uploaded',exists(select 1 from storage.objects o where o.bucket_id='device-file-originals' and o.name=r.storage_path));
end $$;

create function device_media_private.complete_original(p_request_id uuid,p_size bigint,p_modified bigint) returns jsonb
language plpgsql security definer set search_path='' as $$
declare ticket jsonb; r public.device_file_transfers; object_size bigint;
begin
 ticket:=device_media_private.device_ticket(p_request_id);
 select * into r from public.device_file_transfers where id=p_request_id for update;
 if p_size is distinct from r.expected_size or p_modified is distinct from r.expected_modified
 then raise exception 'Original changed since request'; end if;
 select (o.metadata->>'size')::bigint into object_size from storage.objects o
 where o.bucket_id='device-file-originals' and o.name=r.storage_path;
 if object_size is distinct from r.expected_size then raise exception 'Uploaded original size mismatch'; end if;
 update public.device_file_transfers set completed_at=coalesce(completed_at,now()) where id=r.id;
 return jsonb_build_object('request_id',r.id,'size',r.expected_size,'expires_at',r.expires_at,'ready',true);
end $$;

create function device_media_private.admin_status(p_request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.device_file_transfers; c public.commands;
begin
 select * into r from public.device_file_transfers where id=p_request_id;
 if auth.uid() is null or r.id is null or not coalesce(public.can_manage_school(r.school_id),false)
 or not exists(select 1 from public.devices d where d.id=r.device_id and d.school_id=r.school_id)
 then raise exception 'Transfer unavailable' using errcode='42501'; end if;
 select * into c from public.commands where id=r.command_id;
 return jsonb_build_object('request_id',r.id,'device_id',r.device_id,'filename',r.filename,'size',r.expected_size,
 'expires_at',r.expires_at,'storage_path',case when r.completed_at is not null and r.expires_at>now() and r.cleaned_at is null then r.storage_path else null end,
 'status',case when r.expires_at<=now() or r.cleaned_at is not null then 'expired'
 when r.completed_at is not null then 'ready' when c.id is null then 'cancelled' else c.status end,
 'error',case when c.status='failed' then c.result->>'error' else null end);
end $$;

create function device_media_private.can_upload(object_name text) returns boolean
language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(
 select 1 from public.device_file_transfers t join public.devices d on d.id=t.device_id join public.commands c on c.id=t.command_id
 where t.storage_path=object_name and d.auth_user_id=auth.uid() and d.id=public.current_device_id()
 and d.school_id=t.school_id and d.status not in ('pending','retired') and t.completed_at is null
 and t.cleaned_at is null and t.expires_at>now() and c.type='retrieve_file' and c.status in ('pending','delivered')
 and c.payload->>'request_id'=t.id::text)
$$;
create function device_media_private.can_download(object_name text) returns boolean
language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(
 select 1 from public.device_file_transfers t join public.devices d on d.id=t.device_id
 where t.storage_path=object_name and d.school_id=t.school_id and t.completed_at is not null
 and t.cleaned_at is null and t.expires_at>now() and coalesce(public.can_manage_school(t.school_id),false))
$$;
create policy device_original_upload on storage.objects for insert to authenticated
 with check(bucket_id='device-file-originals' and device_media_private.can_upload(name));
create policy device_original_download on storage.objects for select to authenticated
 using(bucket_id='device-file-originals' and device_media_private.can_download(name));
-- No client UPDATE, DELETE, overwrite, device read, teacher read, or public read.

create function public.request_device_file(p_device_id uuid,p_path text,p_size bigint,p_modified bigint) returns jsonb
language sql security invoker set search_path='' as $$ select device_media_private.request_original(p_device_id,p_path,p_size,p_modified) $$;
create function public.device_file_transfer_ticket(p_request_id uuid) returns jsonb
language sql security invoker set search_path='' as $$ select device_media_private.device_ticket(p_request_id) $$;
create function public.device_file_transfer_complete(p_request_id uuid,p_size bigint,p_modified bigint) returns jsonb
language sql security invoker set search_path='' as $$ select device_media_private.complete_original(p_request_id,p_size,p_modified) $$;
create function public.admin_device_file_transfer(p_request_id uuid) returns jsonb
language sql security invoker set search_path='' as $$ select device_media_private.admin_status(p_request_id) $$;

revoke all on all functions in schema device_media_private from public,anon,authenticated;
grant execute on function device_media_private.request_original(uuid,text,bigint,bigint),
 device_media_private.device_ticket(uuid),device_media_private.complete_original(uuid,bigint,bigint),
 device_media_private.admin_status(uuid),device_media_private.can_upload(text),device_media_private.can_download(text)
 to authenticated;
revoke all on function public.request_device_file(uuid,text,bigint,bigint),public.device_file_transfer_ticket(uuid),
 public.device_file_transfer_complete(uuid,bigint,bigint),public.admin_device_file_transfer(uuid) from public,anon;
grant execute on function public.request_device_file(uuid,text,bigint,bigint),public.device_file_transfer_ticket(uuid),
 public.device_file_transfer_complete(uuid,bigint,bigint),public.admin_device_file_transfer(uuid) to authenticated;
