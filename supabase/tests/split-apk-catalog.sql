-- Read-only final state: all fixture modifications and sync notifications roll back.
begin;
do $$
declare d public.devices; i public.hub_items; result jsonb; denied boolean;
begin
 if has_function_privilege('anon','public.device_hub()','execute')
  or has_function_privilege('anon','public.device_hub_action(text,uuid,text,text)','execute')
  or has_function_privilege('authenticated','public.device_hub_before_split_apks()','execute')
  or has_function_privilege('authenticated','public.device_hub_action_before_split_apks(text,uuid,text,text)','execute') then
  raise exception 'RPC grants expose private compatibility helpers';
 end if;
 select * into d from public.devices where school_id='14eea188-73b1-40bc-8f8d-15afbea27ffa' and status='active' and auth_user_id is not null order by agent_version_code desc limit 1;
 if d.id is null then raise exception 'No active test identity';end if;
 select * into i from public.hub_items where package_name='all.in.one.calculator' and kind='app' and published
  and (school_id=d.school_id or (school_id is null and exists(select 1 from public.hub_access a where a.school_id=d.school_id and a.item_id=hub_items.id))) limit 1;
 if i.id is null then raise exception 'Missing scoped Calculator fixture';end if;
 update public.hub_items set storage_path=storage_path||'.psapk',mime_type='application/vnd.primesecure.apk-set+zip' where id=i.id;
 perform set_config('request.jwt.claim.sub',d.auth_user_id::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',d.auth_user_id,'role','authenticated')::text,true);
 update public.devices set agent_version_code=33 where id=d.id;
 result:=public.device_hub();
 if exists(select 1 from jsonb_array_elements(result->'items') v where v->>'id'=i.id::text)
  or not (result->>'apk_set_update_required')::boolean then raise exception 'Old client received an APK set';end if;
 denied:=false;
 begin perform public.device_hub_action('install',i.id); exception when sqlstate '22023' then denied:=true;end;
 if not denied then raise exception 'Old client queued a split install';end if;
 update public.devices set agent_version_code=null where id=d.id;
 result:=public.device_hub();
 if exists(select 1 from jsonb_array_elements(result->'items') v where v->>'id'=i.id::text) then raise exception 'Unknown client received APK set';end if;
 update public.devices set agent_version_code=34 where id=d.id;
 result:=public.device_hub();
 if not exists(select 1 from jsonb_array_elements(result->'items') v where v->>'id'=i.id::text) then raise exception 'Supported client cannot see approved APK set';end if;
 perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
 denied:=false;
 begin perform public.device_hub(); exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Unenrolled caller received device catalog';end if;
 raise notice 'PASS: private grants, old/null/supported client catalogs, direct-install guard, unenrolled denial; rollback follows';
end $$;
rollback;
