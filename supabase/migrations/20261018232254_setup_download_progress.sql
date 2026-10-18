-- Latest observed catalogue readiness, not an ETA or full device-policy setup completion.
-- Device writes need a restricted RPC because authenticated clients have no table write grants.
create table public.device_setup_progress (
 device_id uuid primary key references public.devices(id) on delete cascade,
 school_id uuid not null references public.schools(id) on delete cascade,
 auth_user_id uuid not null,
 session_id uuid not null,
 catalog_signature text not null check(catalog_signature ~ '^[a-f0-9]{64}$'),
 report jsonb not null,
 reported_at timestamptz not null default now(),
 completed_at timestamptz
);
create index device_setup_progress_school on public.device_setup_progress(school_id);
alter table public.device_setup_progress enable row level security;
revoke all on public.device_setup_progress from public,anon,authenticated;
grant select on public.device_setup_progress to authenticated;
create policy device_setup_progress_read on public.device_setup_progress for select to authenticated using (
 coalesce(public.can_manage_school(school_id),false) and exists (
  select 1 from public.devices d where d.id=device_id and d.school_id=device_setup_progress.school_id
   and d.auth_user_id=device_setup_progress.auth_user_id and d.status not in ('pending','retired')
 )
);

create function public.device_report_setup_progress(p_report jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare d public.devices; s jsonb; streams jsonb:='[]'; kind text; key text;
 total bigint; done bigint; total_bytes bigint; done_bytes bigint; elapsed bigint; all_complete boolean:=true;
begin
 if auth.uid() is null then raise exception 'Not an enrolled device' using errcode='42501'; end if;
 select * into d from public.devices where id=public.current_device_id() and auth_user_id=auth.uid()
  and status not in ('pending','retired') for share;
 if d.id is null then raise exception 'Not an enrolled device' using errcode='42501'; end if;
 if p_report is null or jsonb_typeof(p_report)<>'object' or octet_length(p_report::text)>8000
  or p_report->>'catalog_known' is distinct from 'true'
  or coalesce(p_report->>'catalog_signature','') !~ '^[a-f0-9]{64}$'
  or coalesce(p_report->>'session_id','') !~ '^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$'
  or coalesce(p_report->>'elapsed_ms','') !~ '^[0-9]{1,12}$'
  or (p_report->>'elapsed_ms')::bigint>315576000000
  or jsonb_typeof(p_report->'streams') is distinct from 'array' then raise exception 'Invalid setup report'; end if;
 if jsonb_array_length(p_report->'streams')<>3 then raise exception 'Expected three setup streams'; end if;
 elapsed:=(p_report->>'elapsed_ms')::bigint;
 foreach kind in array array['wallpaper','app','resource'] loop
  if (select count(*) from jsonb_array_elements(p_report->'streams') x where x->>'kind'=kind)<>1 then raise exception 'Invalid setup streams'; end if;
  select value into s from jsonb_array_elements(p_report->'streams') where value->>'kind'=kind;
  foreach key in array array['total_items','completed_items','total_bytes','completed_bytes','elapsed_ms'] loop
   if coalesce(s->>key,'') !~ '^[0-9]{1,15}$' then raise exception 'Invalid setup counter'; end if;
  end loop;
  total:=(s->>'total_items')::bigint; done:=(s->>'completed_items')::bigint;
  total_bytes:=(s->>'total_bytes')::bigint; done_bytes:=(s->>'completed_bytes')::bigint;
  if total>1000000 or done>total or done_bytes>total_bytes or (s->>'elapsed_ms')::bigint>elapsed
   or coalesce(s->>'complete','') not in ('true','false')
   or (s->>'complete')::boolean is distinct from (done=total) then raise exception 'Inconsistent setup counters'; end if;
  all_complete:=all_complete and (done=total);
  streams:=streams||jsonb_build_array(jsonb_build_object('kind',kind,'label',case kind when 'wallpaper' then 'Wallpapers' when 'app' then 'Apps' else 'School notes' end,
   'total_items',total,'completed_items',done,'total_bytes',total_bytes,'completed_bytes',done_bytes,
   'elapsed_ms',(s->>'elapsed_ms')::bigint,'complete',done=total));
 end loop;
 if coalesce(p_report->>'complete','') not in ('true','false') or (p_report->>'complete')::boolean is distinct from all_complete
  or coalesce(p_report->>'clock_estimated','') not in ('true','false') then raise exception 'Inconsistent setup completion'; end if;
 -- Store only known counters; never accept device IDs, school IDs or arbitrary uploaded data.
 insert into public.device_setup_progress(device_id,school_id,auth_user_id,session_id,catalog_signature,report,completed_at)
 values(d.id,d.school_id,d.auth_user_id,(p_report->>'session_id')::uuid,p_report->>'catalog_signature',
  jsonb_build_object('streams',streams,'elapsed_ms',elapsed,'complete',all_complete,'catalog_known',true,
   'duration_basis','since_catalog_observed_including_offline_and_queue_wait','clock_estimated',(p_report->>'clock_estimated')::boolean),
  case when all_complete then now() else null end)
 on conflict(device_id) do update set school_id=excluded.school_id,auth_user_id=excluded.auth_user_id,
  session_id=excluded.session_id,catalog_signature=excluded.catalog_signature,report=excluded.report,reported_at=now(),
  completed_at=case when excluded.completed_at is null then null
   when device_setup_progress.session_id=excluded.session_id and device_setup_progress.auth_user_id=excluded.auth_user_id
    then coalesce(device_setup_progress.completed_at,excluded.completed_at) else excluded.completed_at end;
 return jsonb_build_object('ok',true);
end $$;
revoke all on function public.device_report_setup_progress(jsonb) from public,anon,authenticated;
grant execute on function public.device_report_setup_progress(jsonb) to authenticated;

-- INVOKER so both the explicit manager check and table RLS constrain the aggregate.
create function public.staff_setup_summary(p_school uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare result jsonb; streams jsonb;
begin
 if auth.uid() is null or not coalesce(public.can_manage_school(p_school),false) then
  raise exception 'School administrator access required' using errcode='42501'; end if;
 select jsonb_build_object('reporting_devices',count(*),'complete_devices',count(*) filter(where (report->>'complete')::boolean),
  'setup_samples',count(*) filter(where (report->>'complete')::boolean and exists(select 1 from jsonb_array_elements(report->'streams') s where (s->>'total_items')::bigint>0)),
  'avg_setup_ms',avg((report->>'elapsed_ms')::bigint) filter(where (report->>'complete')::boolean and exists(select 1 from jsonb_array_elements(report->'streams') s where (s->>'total_items')::bigint>0)))
 into result from public.device_setup_progress where school_id=p_school;
 select jsonb_agg(stats order by priority) into streams from (
  select k.priority,k.kind,count(*) filter(where (s->>'complete')::boolean and (s->>'total_items')::bigint>0) as samples,
   avg((s->>'elapsed_ms')::bigint) filter(where (s->>'complete')::boolean and (s->>'total_items')::bigint>0) as avg_elapsed_ms
  from (values(0,'wallpaper'),(1,'app'),(2,'resource')) k(priority,kind)
  left join public.device_setup_progress p on p.school_id=p_school
  left join lateral jsonb_array_elements(p.report->'streams') s on s->>'kind'=k.kind
  group by k.priority,k.kind
 ) stats;
 return result||jsonb_build_object('streams',streams,'duration_basis','since_catalog_observed_including_offline_and_queue_wait');
end $$;
revoke all on function public.staff_setup_summary(uuid) from public,anon,authenticated;
grant execute on function public.staff_setup_summary(uuid) to authenticated;
notify pgrst,'reload schema';
