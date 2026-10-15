-- Durable, device-readable hints. Catalog RLS stays unchanged.
alter table public.devices
 add column sync_revision bigint not null default 0,
 add column sync_applied_revision bigint not null default 0,
 add column sync_topics text[] not null default '{}',
 add column sync_requested_at timestamptz,
 add column sync_applied_at timestamptz;

create function public.queue_device_sync(p_school uuid,p_device uuid,p_topic text) returns void
language sql security definer set search_path='' as $$
 update public.devices d set sync_revision=d.sync_revision+1,sync_requested_at=now(),
 sync_topics=array(select distinct x from unnest(
   case when d.sync_revision>d.sync_applied_revision then d.sync_topics else '{}'::text[] end || array[p_topic]) x order by x)
 where d.status not in ('pending','retired') and (p_school is null or d.school_id=p_school) and (p_device is null or d.id=p_device)
$$;
revoke all on function public.queue_device_sync(uuid,uuid,text) from public,anon,authenticated;

create function public.signal_device_sync() returns trigger language plpgsql security definer set search_path='' as $$
declare r jsonb; prior jsonb; topic text;
begin
 r:=case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
 topic:=case when tg_table_name='hub_items' then case r->>'kind' when 'resource' then 'notes' when 'wallpaper' then 'wallpapers' else 'apps' end
             when tg_table_name='hub_access' then 'library' else 'settings' end;
 perform public.queue_device_sync((r->>'school_id')::uuid,case when tg_table_name='policies' then (r->>'device_id')::uuid else null end,topic);
 if tg_op='UPDATE' then
  prior:=to_jsonb(old);
  if prior->>'school_id' is distinct from r->>'school_id' or (tg_table_name='policies' and prior->>'device_id' is distinct from r->>'device_id') then
   perform public.queue_device_sync((prior->>'school_id')::uuid,case when tg_table_name='policies' then (prior->>'device_id')::uuid else null end,topic);
  end if;
 end if;
 return case when tg_op='DELETE' then old else new end;
end $$;
revoke all on function public.signal_device_sync() from public,anon,authenticated;
create trigger hub_settings_sync after insert or update or delete on public.hub_settings for each row execute function public.signal_device_sync();
create trigger hub_items_sync after insert or update or delete on public.hub_items for each row execute function public.signal_device_sync();
create trigger hub_access_sync after insert or update or delete on public.hub_access for each row execute function public.signal_device_sync();
create trigger policies_sync after insert or update or delete on public.policies for each row execute function public.signal_device_sync();

create function public.device_sync_state() returns jsonb language plpgsql security definer set search_path='' as $$
declare d public.devices;
begin
 select * into d from public.devices where id=public.current_device_id() and auth_user_id=auth.uid() and status not in ('pending','retired');
 if d.id is null then raise exception 'not an enrolled device' using errcode='42501'; end if;
 return jsonb_build_object('revision',d.sync_revision,'applied_revision',d.sync_applied_revision,'topics',d.sync_topics,'requested_at',d.sync_requested_at,'applied_at',d.sync_applied_at);
end $$;
create function public.device_ack_sync(p_revision bigint) returns jsonb language plpgsql security definer set search_path='' as $$
declare d public.devices;
begin
 select * into d from public.devices where id=public.current_device_id() and auth_user_id=auth.uid() and status not in ('pending','retired') for update;
 if d.id is null then raise exception 'not an enrolled device' using errcode='42501'; end if;
 if p_revision is null or p_revision<0 or p_revision>d.sync_revision then raise exception 'invalid sync revision'; end if;
 if p_revision>d.sync_applied_revision then
  update public.devices set sync_applied_revision=p_revision,sync_applied_at=now() where id=d.id;
 end if;
 return public.device_sync_state();
end $$;
create function public.staff_request_device_sync(p_device uuid) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.devices where id=p_device and public.can_manage_school(school_id) and status not in ('pending','retired')) then
  raise exception 'school administrator access required' using errcode='42501'; end if;
 perform public.queue_device_sync(null,p_device,'settings');
 return jsonb_build_object('queued',true);
end $$;
revoke all on function public.device_sync_state(),public.device_ack_sync(bigint),public.staff_request_device_sync(uuid) from public,anon;
grant execute on function public.device_sync_state(),public.device_ack_sync(bigint),public.staff_request_device_sync(uuid) to authenticated;
-- One initial reconciliation when an existing enrolled device upgrades.
select public.queue_device_sync(null,null,'settings');
notify pgrst,'reload schema';
