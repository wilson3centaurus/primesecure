create table public.hub_app_defaults (
 school_id uuid not null references public.schools(id) on delete cascade,
 item_id uuid not null references public.hub_items(id) on delete cascade,
 preinstall boolean not null,
 primary key(school_id,item_id)
);
alter table public.hub_app_defaults enable row level security;
revoke all on public.hub_app_defaults from anon,authenticated;
grant select on public.hub_app_defaults to authenticated;
create policy hub_app_defaults_read on public.hub_app_defaults for select to authenticated using(public.can_view_school(school_id));
create function public.signal_app_default_sync() returns trigger language plpgsql security definer set search_path='' as $$
begin perform public.queue_device_sync(case when tg_op='DELETE' then old.school_id else new.school_id end,null,'apps');return case when tg_op='DELETE' then old else new end;end;
$$;
revoke all on function public.signal_app_default_sync() from public,anon,authenticated;
create trigger hub_app_defaults_sync after insert or update or delete on public.hub_app_defaults for each row execute function public.signal_app_default_sync();
create function public.staff_app_default(p_school uuid,p_item uuid,p_preinstall boolean) returns void language plpgsql security definer set search_path='' as $$
declare i public.hub_items;
begin
 if auth.uid() is null or not public.can_manage_school(p_school) then raise exception 'School administrator access required' using errcode='42501';end if;
 if p_preinstall is null then raise exception 'Choose default or optional' using errcode='22023';end if;
 select * into i from public.hub_items where id=p_item and kind='app';
 if not found or (i.school_id is not null and i.school_id<>p_school) then raise exception 'App unavailable in this school' using errcode='42501';end if;
 if p_preinstall and (not i.published or (i.school_id is null and not exists(select 1 from public.hub_access where school_id=p_school and item_id=p_item))) then
  raise exception 'Enable this app for the school before making it a default install' using errcode='22023';
 end if;
 insert into public.hub_app_defaults(school_id,item_id,preinstall) values(p_school,p_item,p_preinstall)
 on conflict(school_id,item_id) do update set preinstall=excluded.preinstall;
end;
$$;
revoke all on function public.staff_app_default(uuid,uuid,boolean) from public,anon;
grant execute on function public.staff_app_default(uuid,uuid,boolean) to authenticated;
alter function public.device_hub() rename to device_hub_before_app_defaults;
revoke all on function public.device_hub_before_app_defaults() from public,anon,authenticated,service_role;
create function public.device_hub() returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; school uuid;
begin
 result:=public.device_hub_before_app_defaults();
 select school_id into school from public.devices where auth_user_id=auth.uid() and status<>'retired';
 if school is null then raise exception 'Not an enrolled device' using errcode='42501';end if;
 return jsonb_set(result,'{items}',coalesce((select jsonb_agg(case when item->>'kind'='app' then jsonb_set(item,'{preinstall}',to_jsonb(coalesce(d.preinstall,(item->>'preinstall')::boolean,false))) else item end order by ordinal)
 from jsonb_array_elements(result->'items') with ordinality as entries(item,ordinal)
 left join public.hub_app_defaults d on d.school_id=school and d.item_id=(item->>'id')::uuid),'[]'::jsonb));
end;
$$;
revoke all on function public.device_hub() from public,anon;
grant execute on function public.device_hub() to authenticated,service_role;
notify pgrst,'reload schema';
