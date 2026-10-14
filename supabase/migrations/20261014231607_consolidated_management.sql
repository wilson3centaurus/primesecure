-- One school-approved app catalogue; legacy package lists remain available only
-- when an administrator explicitly disables catalogue-only enforcement.
alter table public.hub_settings add column approved_apps_only boolean not null default true;
alter table public.commands add column deleted_at timestamptz;
create index commands_message_deleted on public.commands(device_id,deleted_at) where type='message' and deleted_at is not null;

create or replace function public.hub_app_allowed(p_device uuid,p_package text) returns boolean
language sql stable security definer set search_path='' as $$
 select case when coalesce(s.approved_apps_only,g.approved_apps_only,true) then exists(
  select 1 from public.hub_items i where i.kind='app' and i.published and i.package_name=p_package
  and (i.school_id=d.school_id or (i.school_id is null and exists(select 1 from public.hub_access a where a.item_id=i.id and a.school_id=d.school_id)))
 ) else not(coalesce(p->'hidden_apps','[]'::jsonb) ? p_package)
  and (coalesce(p->'allowed_apps','[]'::jsonb)='[]'::jsonb or p->'allowed_apps' ? p_package) end
 from public.devices d left join public.hub_settings s on s.school_id=d.school_id
 left join public.hub_settings g on g.scope='global'
 cross join lateral (select public.effective_policy(d.id) p) policy where d.id=p_device
$$;
revoke all on function public.hub_app_allowed(uuid,text) from public,anon,authenticated;

alter function public.device_hub() rename to device_hub_offline;
revoke all on function public.device_hub_offline() from public,anon,authenticated,service_role;
create function public.device_hub() returns jsonb language plpgsql security definer set search_path='' as $$
declare d public.devices; result jsonb; catalog_only boolean; packages jsonb;
begin
 select * into d from public.devices where auth_user_id=auth.uid() and auth.uid() is not null and status<>'retired';
 if d.id is null then raise exception 'not an enrolled device' using errcode='42501'; end if;
 result:=public.device_hub_offline();
 select coalesce((select approved_apps_only from public.hub_settings where school_id=d.school_id),(select approved_apps_only from public.hub_settings where scope='global'),true) into catalog_only;
 select coalesce(jsonb_agg(distinct i.package_name),'[]'::jsonb) into packages from public.hub_items i
 where i.kind='app' and i.published and (i.school_id=d.school_id or (i.school_id is null and exists(select 1 from public.hub_access a where a.item_id=i.id and a.school_id=d.school_id)));
 return result || jsonb_build_object('management',coalesce(result->'management','{}'::jsonb)||jsonb_build_object('approved_apps_only',catalog_only,'approved_packages',packages));
end $$;
revoke all on function public.device_hub() from public,anon;
grant execute on function public.device_hub() to authenticated,service_role;

-- Recall messages without destroying the staff delivery audit or forging receipts.
-- Teachers may recall only their own messages; admins may recall their school's.
create function public.staff_delete_messages(p_ids uuid[]) returns jsonb language plpgsql security definer set search_path='' as $$
declare changed integer;
begin
 if auth.uid() is null or public.auth_role() is null or coalesce(cardinality(p_ids),0) not between 1 and 500 then raise exception 'Invalid message selection' using errcode='42501'; end if;
 perform 1 from public.commands where id=any(p_ids) for update;
 if exists(select 1 from unnest(p_ids) wanted(id) left join public.commands c on c.id=wanted.id
  where c.id is null or c.type<>'message' or not coalesce(public.can_manage_school(c.school_id) or (public.can_view_school(c.school_id) and c.created_by=auth.uid()),false))
 then raise exception 'You cannot delete these messages' using errcode='42501'; end if;
 update public.commands set deleted_at=now(),status='cancelled' where id=any(p_ids) and deleted_at is null;
 get diagnostics changed=row_count;
 return jsonb_build_object('deleted',changed);
end $$;
revoke all on function public.staff_delete_messages(uuid[]) from public,anon;
grant execute on function public.staff_delete_messages(uuid[]) to authenticated,service_role;

create or replace function public.device_message_history() returns jsonb language plpgsql security definer set search_path='' as $$
declare did uuid:=public.current_device_id();
begin
 if did is null or auth.uid() is null then raise exception 'not an enrolled device' using errcode='42501'; end if;
 return jsonb_build_object('messages',coalesce((select jsonb_agg(to_jsonb(c) order by c.created_at desc) from
 (select id,payload,created_at,acknowledged_at,seen_at from public.commands where device_id=did and type='message' and status<>'cancelled' and deleted_at is null order by created_at desc limit 1000)c),'[]'::jsonb),
 'deleted_ids',coalesce((select jsonb_agg(id) from public.commands where device_id=did and type='message' and deleted_at is not null),'[]'::jsonb),
 'replies',coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at) from public.message_replies r join public.commands c on c.id=r.command_id where r.device_id=did and c.deleted_at is null),'[]'::jsonb));
end $$;
revoke all on function public.device_message_history() from public,anon;
grant execute on function public.device_message_history() to authenticated,service_role;

