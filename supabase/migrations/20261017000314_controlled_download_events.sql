alter table public.policies add column web_download_rules jsonb not null default '{}'
 check(jsonb_typeof(web_download_rules)='object' and length(web_download_rules::text)<=24000);

-- Same row selection as the original policy: a device override replaces school policy.
alter function public.effective_policy(uuid) rename to effective_policy_media_base;
revoke all on function public.effective_policy_media_base(uuid) from public,anon,authenticated,service_role;
create function public.effective_policy(p_device_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select case when base='{}'::jsonb then base else base||jsonb_build_object('web_download_rules',coalesce(
  (select p.web_download_rules from public.policies p join public.devices d on d.id=p_device_id
   where p.device_id=d.id or (p.device_id is null and p.school_id=d.school_id)
   order by (p.device_id is null) limit 1),'{}'::jsonb)) end
 from (select public.effective_policy_media_base(p_device_id) base) original
$$;
revoke all on function public.effective_policy(uuid) from public,anon,authenticated;
grant execute on function public.effective_policy(uuid) to service_role;
notify pgrst,'reload schema';
