-- Preserve the existing school/policy/default checks. Older clients must never
-- mistake a ZIP of APKs for one installable APK. This changes no device settings.
alter function public.device_hub() rename to device_hub_before_split_apks;
revoke all on function public.device_hub_before_split_apks() from public,anon,authenticated,service_role;

create function public.device_hub() returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb; d public.devices; filtered jsonb; omitted integer;
begin
 result:=public.device_hub_before_split_apks();
 select * into d from public.devices where auth_user_id=auth.uid() and auth.uid() is not null and status<>'retired';
 if d.id is null then raise exception 'Not an enrolled device' using errcode='42501';end if;
 select coalesce(jsonb_agg(item order by ordinal),'[]'::jsonb),
        jsonb_array_length(coalesce(result->'items','[]'::jsonb))-count(*)::integer
 into filtered,omitted
 from jsonb_array_elements(coalesce(result->'items','[]'::jsonb)) with ordinality as entries(item,ordinal)
 where not (item->>'kind'='app'
   and (lower(coalesce(item->>'storage_path','')) like '%.psapk' or item->>'mime_type'='application/vnd.primesecure.apk-set+zip')
   and coalesce(d.agent_version_code,0)<34);
 return jsonb_set(result,'{items}',filtered)||jsonb_build_object(
  'apk_set_min_agent_version_code',34,'apk_set_update_required',omitted>0,'apk_set_apps_waiting_for_update',omitted);
end $$;
revoke all on function public.device_hub() from public,anon;
grant execute on function public.device_hub() to authenticated,service_role;

alter function public.device_hub_action(text,uuid,text,text) rename to device_hub_action_before_split_apks;
revoke all on function public.device_hub_action_before_split_apks(text,uuid,text,text) from public,anon,authenticated,service_role;
create function public.device_hub_action(p_action text,p_item_id uuid default null,p_name text default '',p_reason text default '') returns jsonb
language plpgsql security definer set search_path='' as $$
declare d public.devices;
begin
 if p_action='install' then
  select * into d from public.devices where auth_user_id=auth.uid() and auth.uid() is not null and status='active';
  if d.id is null then raise exception 'Not an active enrolled device' using errcode='42501';end if;
  if coalesce(d.agent_version_code,0)<34 and exists(select 1 from public.hub_items i
   where i.id=p_item_id and i.kind='app' and (lower(i.storage_path) like '%.psapk' or i.mime_type='application/vnd.primesecure.apk-set+zip')
   and (i.school_id=d.school_id or (i.school_id is null and exists(select 1 from public.hub_access a where a.school_id=d.school_id and a.item_id=i.id)))) then
   raise exception 'Update PrimeSecure to 0.9.1 (code 34) before installing split APK apps' using errcode='22023';
  end if;
 end if;
 return public.device_hub_action_before_split_apks(p_action,p_item_id,p_name,p_reason);
end $$;
revoke all on function public.device_hub_action(text,uuid,text,text) from public,anon;
grant execute on function public.device_hub_action(text,uuid,text,text) to authenticated,service_role;
notify pgrst,'reload schema';
