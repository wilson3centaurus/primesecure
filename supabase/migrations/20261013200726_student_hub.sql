-- Student hub: shared content is opt-in per school; devices never write catalog data.
create table public.hub_items (
 id uuid primary key default gen_random_uuid(),
 school_id uuid references public.schools(id) on delete cascade,
 kind text not null check (kind in ('resource','wallpaper','app')),
 title text not null check (length(trim(title)) between 1 and 160),
 description text not null default '',
 form_level text not null default '', subject text not null default '',
 category text not null default 'Notes',
 storage_path text not null unique,
 mime_type text not null default 'application/octet-stream',
 size bigint not null check (size > 0),
 package_name text,
 published boolean not null default true,
 preinstall boolean not null default false,
 created_at timestamptz not null default now(),
 constraint hub_path_scope check (split_part(storage_path,'/',1) = coalesce(school_id::text,'shared')),
 constraint hub_app_package check (kind <> 'app' or (package_name is not null and package_name <> 'com.robokorda.primesecure' and package_name ~ '^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$'))
);
create index hub_items_school_kind on public.hub_items(school_id,kind);
create table public.hub_access (
 item_id uuid not null references public.hub_items(id) on delete cascade,
 school_id uuid not null references public.schools(id) on delete cascade,
 primary key (item_id,school_id)
);
create index hub_access_school on public.hub_access(school_id,item_id);
create table public.hub_settings (
 scope text primary key,
 school_id uuid unique references public.schools(id) on delete cascade,
 default_wallpaper_id uuid references public.hub_items(id) on delete set null,
 allow_wallpaper_choice boolean not null default true,
 hide_vendor_store boolean not null default false,
 check (scope = coalesce(school_id::text,'global'))
);
create table public.hub_requests (
 id uuid primary key default gen_random_uuid(),
 device_id uuid not null references public.devices(id) on delete cascade,
 school_id uuid not null references public.schools(id) on delete cascade,
 name text not null check(length(trim(name)) between 1 and 160),
 reason text not null default '' check(length(reason) <= 1000),
 status text not null default 'requested' check(status in ('requested','reviewing','approved','declined')),
 created_at timestamptz not null default now()
);
create index hub_requests_school on public.hub_requests(school_id,created_at desc);
create index hub_requests_device on public.hub_requests(device_id,created_at desc);
alter table public.devices add column battery_diagnostics jsonb, add column wallpaper_choice_id uuid references public.hub_items(id) on delete set null;
alter table public.commands add column acknowledged_at timestamptz;
-- Column-level command grants are tightened to keep a staff delivery edit from forging acknowledgement.
revoke update on public.commands from authenticated;
grant update(status) on public.commands to authenticated;
revoke insert on public.commands from authenticated;
grant insert(device_id,school_id,type,payload,created_by,status) on public.commands to authenticated;

create function public.hub_can_read(p_item uuid) returns boolean
language sql stable security definer set search_path = '' as $$
 select auth.uid() is not null and exists (
 select 1 from public.hub_items i where i.id=p_item and (
 public.can_view_school(i.school_id) or (i.school_id is null and public.auth_role() is not null)
 or (i.published and exists(select 1 from public.devices d where d.auth_user_id=auth.uid() and d.status <> 'retired'
 and (i.school_id=d.school_id or (i.school_id is null and (exists(select 1 from public.hub_access a where a.item_id=i.id and a.school_id=d.school_id)
 or (i.kind='wallpaper' and exists(select 1 from public.hub_settings s where s.default_wallpaper_id=i.id and (s.scope='global' or s.school_id=d.school_id))))))))
 ))
$$;
alter table public.hub_items enable row level security;
alter table public.hub_access enable row level security;
alter table public.hub_settings enable row level security;
alter table public.hub_requests enable row level security;
revoke all on public.hub_items, public.hub_access, public.hub_settings, public.hub_requests from anon;
grant select,insert,update,delete on public.hub_items, public.hub_access, public.hub_settings to authenticated;
grant select on public.hub_requests to authenticated;
revoke insert,update,delete on public.hub_requests from authenticated;
grant update(status) on public.hub_requests to authenticated;
create policy hub_items_read on public.hub_items for select to authenticated using(public.hub_can_read(id));
create policy hub_items_write on public.hub_items for all to authenticated using(public.can_manage_school(school_id)) with check(public.can_manage_school(school_id));
create policy hub_access_read on public.hub_access for select to authenticated using(public.can_view_school(school_id));
create policy hub_access_write on public.hub_access for all to authenticated using(public.can_manage_school(school_id)) with check(public.can_manage_school(school_id));
create policy hub_settings_read on public.hub_settings for select to authenticated using(public.can_view_school(school_id) or (school_id is null and public.auth_role() is not null));
create policy hub_settings_write on public.hub_settings for all to authenticated using(public.can_manage_school(school_id)) with check(public.can_manage_school(school_id));
create policy hub_requests_read on public.hub_requests for select to authenticated using(public.can_view_school(school_id) or device_id=public.current_device_id());
create policy hub_requests_update on public.hub_requests for update to authenticated using(public.can_manage_school(school_id)) with check(public.can_manage_school(school_id));
insert into storage.buckets(id,name,public) values('primesecure-hub','primesecure-hub',false);
insert into storage.buckets(id,name,public) values('primesecure-messages','primesecure-messages',false);
create policy hub_message_images_read on storage.objects for select to authenticated using(bucket_id='primesecure-messages' and
 (public.can_view_school(public.storage_school_id(name)) or exists(select 1 from public.devices d where d.auth_user_id=auth.uid() and d.status<>'retired' and d.school_id=public.storage_school_id(name))));
create policy hub_message_images_insert on storage.objects for insert to authenticated with check(bucket_id='primesecure-messages' and public.can_view_school(public.storage_school_id(name)));
create policy hub_message_images_delete on storage.objects for delete to authenticated using(bucket_id='primesecure-messages' and public.can_manage_school(public.storage_school_id(name)));
create policy hub_objects_read on storage.objects for select to authenticated using(bucket_id='primesecure-hub' and (
 public.can_manage_school(public.storage_school_id(name)) and split_part(name,'/',1)<>'shared'
 or split_part(name,'/',1)='shared' and public.is_super_admin()
 or exists(select 1 from public.hub_items i where i.storage_path=name and public.hub_can_read(i.id))
));
create policy hub_objects_insert on storage.objects for insert to authenticated with check(bucket_id='primesecure-hub' and (
 (split_part(name,'/',1)='shared' and public.is_super_admin()) or (public.storage_school_id(name) is not null and public.can_manage_school(public.storage_school_id(name)))
));
create policy hub_objects_delete on storage.objects for delete to authenticated using(bucket_id='primesecure-hub' and (
 (split_part(name,'/',1)='shared' and public.is_super_admin()) or (public.storage_school_id(name) is not null and public.can_manage_school(public.storage_school_id(name)))
));

-- Internal helper: catalog apps must agree with the existing device/school app policy.
create function public.hub_app_allowed(p_device uuid,p_package text) returns boolean language sql stable security definer set search_path='' as $$
 select not(coalesce(p->'hidden_apps','[]'::jsonb) ? p_package)
 and (coalesce(p->'allowed_apps','[]'::jsonb)='[]'::jsonb or p->'allowed_apps' ? p_package)
 from (select public.effective_policy(p_device) p) policy
$$;
revoke all on function public.hub_app_allowed(uuid,text) from public,anon,authenticated;

create function public.device_hub() returns jsonb language plpgsql security definer set search_path='' as $$
declare d public.devices; cfg public.hub_settings; global_cfg public.hub_settings; w uuid;
begin
 select * into d from public.devices where auth_user_id=auth.uid() and auth.uid() is not null and status<>'retired';
 if d.id is null then raise exception 'not an enrolled device' using errcode='42501'; end if;
 select * into cfg from public.hub_settings where school_id=d.school_id;
 select * into global_cfg from public.hub_settings where scope='global';
 select i.id into w from public.hub_items i where i.id=d.wallpaper_choice_id and i.kind='wallpaper' and i.published and coalesce(cfg.allow_wallpaper_choice,global_cfg.allow_wallpaper_choice,true)
 and (i.school_id=d.school_id or (i.school_id is null and exists(select 1 from public.hub_access a where a.item_id=i.id and a.school_id=d.school_id)));
 w := coalesce(w,(select id from public.hub_items where id=cfg.default_wallpaper_id and published and kind='wallpaper' and (school_id=d.school_id or school_id is null)),global_cfg.default_wallpaper_id);
 return jsonb_build_object(
 'items',coalesce((select jsonb_agg(to_jsonb(i) order by i.form_level,i.subject,i.title) from public.hub_items i where i.published and (i.kind<>'app' or public.hub_app_allowed(d.id,i.package_name)) and (i.school_id=d.school_id or (i.school_id is null and exists(select 1 from public.hub_access a where a.item_id=i.id and a.school_id=d.school_id)))),'[]'::jsonb),
 'requests',coalesce((select jsonb_agg(to_jsonb(r)) from (select name,status,created_at from public.hub_requests where device_id=d.id order by created_at desc limit 30) r),'[]'::jsonb),
 'installs',coalesce((select jsonb_agg(to_jsonb(c)) from (select payload->>'hub_item_id' as item_id,status,result,created_at from public.commands where device_id=d.id and type='install_apk' and payload ? 'hub_item_id' order by created_at desc limit 100) c),'[]'::jsonb),
 'wallpaper', (select to_jsonb(i) from public.hub_items i where i.id=w and i.kind='wallpaper' and i.published and (i.school_id=d.school_id or i.school_id is null)),
 'allow_wallpaper_choice',coalesce(cfg.allow_wallpaper_choice,global_cfg.allow_wallpaper_choice,true),
 'hide_vendor_store',coalesce(cfg.hide_vendor_store,global_cfg.hide_vendor_store,false),
 'student_name',d.student_name);
end $$;

create function public.device_hub_action(p_action text,p_item_id uuid default null,p_name text default '',p_reason text default '') returns jsonb
language plpgsql security definer set search_path='' as $$
declare d public.devices; item public.hub_items; cfg jsonb; cmd uuid;
begin
 select * into d from public.devices where auth_user_id=auth.uid() and auth.uid() is not null and status='active' for update;
 if d.id is null then raise exception 'not an active enrolled device' using errcode='42501'; end if;
 if p_action='request_app' then
  if length(trim(p_name)) not between 1 and 160 or length(p_reason)>1000 then raise exception 'invalid request'; end if;
  if (select count(*) from public.hub_requests where device_id=d.id and created_at>now()-interval '1 day')>=10 then raise exception 'Daily request limit reached'; end if;
  insert into public.hub_requests(device_id,school_id,name,reason) values(d.id,d.school_id,trim(p_name),p_reason);
  return jsonb_build_object('ok',true);
 end if;
 select * into item from public.hub_items i where i.id=p_item_id and i.published and (i.school_id=d.school_id or(i.school_id is null and exists(select 1 from public.hub_access a where a.item_id=i.id and a.school_id=d.school_id)));
 if item.id is null then raise exception 'item not available to your school' using errcode='42501'; end if;
 if p_action='wallpaper' and item.kind='wallpaper' then
  cfg:=public.device_hub();
  if not (cfg->>'allow_wallpaper_choice')::boolean then raise exception 'Wallpaper choices disabled'; end if;
  update public.devices set wallpaper_choice_id=item.id where id=d.id;
 elsif p_action='install' and item.kind='app' then
  if not public.hub_app_allowed(d.id,item.package_name) then raise exception 'App blocked by school policy' using errcode='42501'; end if;
  select id into cmd from public.commands where device_id=d.id and type='install_apk' and payload->>'hub_item_id'=item.id::text and status in ('pending','delivered') limit 1;
  if cmd is null then
   insert into public.commands(device_id,school_id,type,payload,created_by) values(d.id,d.school_id,'install_apk',jsonb_build_object('hub_item_id',item.id,'name',item.title,'storage_path',item.storage_path,'bucket','primesecure-hub','package',item.package_name),null) returning id into cmd;
  end if;
 else raise exception 'invalid action'; end if;
 return jsonb_build_object('ok',true,'command_id',cmd);
end $$;

create function public.device_ack_message(p_command_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 update public.commands set acknowledged_at=coalesce(acknowledged_at,now())
 where id=p_command_id and type='message' and status<>'cancelled' and device_id=public.current_device_id() and auth.uid() is not null;
 if not found then raise exception 'message not found' using errcode='42501'; end if;
 return jsonb_build_object('ok',true);
end $$;
create function public.device_message_history() returns jsonb
language plpgsql security definer set search_path='' as $$
declare did uuid:=public.current_device_id();
begin
 if did is null or auth.uid() is null then raise exception 'not an enrolled device' using errcode='42501'; end if;
 return jsonb_build_object('messages',coalesce((select jsonb_agg(to_jsonb(c) order by c.created_at desc) from (select id,payload,created_at,acknowledged_at from public.commands where device_id=did and type='message' and status<>'cancelled') c),'[]'::jsonb));
end $$;
create function public.device_battery_report(p_readings jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 if jsonb_typeof(p_readings)<>'object' or octet_length(p_readings::text)>4096 then raise exception 'invalid readings'; end if;
 update public.devices set battery_diagnostics=p_readings || jsonb_build_object('reported_at',now()) where auth_user_id=auth.uid() and auth.uid() is not null and status<>'retired';
 if not found then raise exception 'not an enrolled device' using errcode='42501'; end if;
 return jsonb_build_object('ok',true);
end $$;
revoke all on function public.hub_can_read(uuid),public.device_hub(),public.device_hub_action(text,uuid,text,text),public.device_ack_message(uuid),public.device_message_history(),public.device_battery_report(jsonb) from public,anon;
grant execute on function public.hub_can_read(uuid),public.device_hub(),public.device_hub_action(text,uuid,text,text),public.device_ack_message(uuid),public.device_message_history(),public.device_battery_report(jsonb) to authenticated,service_role;
