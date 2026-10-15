-- Device-scoped, bounded operational diagnostics. Never a general logcat upload.
create table public.device_events (
 device_id uuid not null references public.devices(id) on delete cascade,
 id uuid not null,
 occurred_at timestamptz not null,
 received_at timestamptz not null default now(),
 severity text not null check(severity in ('info','warning','error','fatal')),
 category text not null check(category in ('boot','policy','check_in','command','download','install','wallpaper','setup','crash','anr','update','safety')),
 code text not null check(code ~ '^[a-z0-9_.:-]{1,80}$'),
 version text not null check(length(version)<=40),
 details jsonb not null default '{}'::jsonb,
 primary key(device_id,id)
);
create index device_events_recent on public.device_events(device_id,received_at desc,id);
alter table public.device_events enable row level security;
revoke all on public.device_events from public,anon,authenticated;
grant select on public.device_events to authenticated;
create policy device_events_staff_read on public.device_events for select to authenticated
 using(exists(select 1 from public.devices d where d.id=device_id and public.can_manage_school(d.school_id)));

create function public.store_device_events(p_device_id uuid,p_events jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare e jsonb; ids jsonb:='[]'::jsonb; eid uuid; occurred timestamptz;
begin
 if p_events is null or jsonb_typeof(p_events)<>'array' or jsonb_array_length(p_events)>30 or octet_length(p_events::text)>180000 then raise exception 'invalid diagnostics batch'; end if;
 perform 1 from public.devices where id=p_device_id and status not in ('pending','retired') for update;
 if not found then raise exception 'not an enrolled device' using errcode='42501'; end if;
 for e in select value from jsonb_array_elements(p_events) loop
  if jsonb_typeof(e)<>'object' or coalesce(e->>'severity','') not in ('info','warning','error','fatal')
   or coalesce(e->>'category','') not in ('boot','policy','check_in','command','download','install','wallpaper','setup','crash','anr','update','safety')
   or coalesce(e->>'code','') !~ '^[a-z0-9_.:-]{1,80}$' or length(coalesce(e->>'version',''))>40
   or jsonb_typeof(coalesce(e->'details','{}'))<>'object' or octet_length(coalesce(e->'details','{}')::text)>5000 then raise exception 'invalid diagnostic event'; end if;
  if exists(select 1 from jsonb_object_keys(coalesce(e->'details','{}')) k where k not in
    ('exception','frames','phase','strict','hidden','suspended','package','elapsed_ms','boot_count','user_unlocked','reason')) then raise exception 'unsupported diagnostic detail'; end if;
  eid:=(e->>'id')::uuid; occurred:=(e->>'occurred_at')::timestamptz;
  if eid is null or occurred is null then raise exception 'missing diagnostic identity'; end if;
  insert into public.device_events(device_id,id,occurred_at,severity,category,code,version,details)
   values(p_device_id,eid,occurred,e->>'severity',e->>'category',e->>'code',coalesce(e->>'version',''),coalesce(e->'details','{}')) on conflict do nothing;
  ids:=ids||jsonb_build_array(eid);
 end loop;
 delete from public.device_events where device_id=p_device_id and id in
  (select id from public.device_events where device_id=p_device_id order by received_at desc,id desc offset 1000);
 return jsonb_build_object('accepted_ids',ids);
end $$;
revoke all on function public.store_device_events(uuid,jsonb) from public,anon,authenticated;

create function public.device_report_events(p_device_id uuid,p_events jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare did uuid:=public.current_device_id();
begin
 if did is null or auth.uid() is null or p_device_id is distinct from did then raise exception 'not an enrolled device' using errcode='42501'; end if;
 return public.store_device_events(did,p_events);
end $$;
revoke all on function public.device_report_events(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.device_report_events(uuid,jsonb) to authenticated;

-- Uses the already-encrypted boot recovery capability; no new access to student data.
alter table public.device_recovery_channels add column last_events_at timestamptz;
create function public.device_recovery_events(p_device_id uuid,p_secret text,p_events jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare channel public.device_recovery_channels;
begin
 if p_secret is null or length(p_secret)<>64 then raise exception 'invalid recovery channel' using errcode='42501'; end if;
 select c.* into channel from public.device_recovery_channels c join public.devices d on d.id=c.device_id
 where c.device_id=p_device_id and d.status not in ('retired','pending') and c.secret_hash=encode(sha256(convert_to(p_secret,'UTF8')),'hex') for update of c;
 if channel.device_id is null then raise exception 'invalid recovery channel' using errcode='42501'; end if;
 if channel.last_events_at>now()-interval '10 seconds' then return jsonb_build_object('accepted_ids','[]'::jsonb,'retry',true); end if;
 update public.device_recovery_channels set last_events_at=now() where device_id=p_device_id;
 return public.store_device_events(p_device_id,p_events);
end $$;
revoke all on function public.device_recovery_events(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.device_recovery_events(uuid,text,jsonb) to anon,authenticated;
notify pgrst,'reload schema';
