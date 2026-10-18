-- Delete folder trees atomically; storage objects are removed only after catalog success.
-- No access is widened, and only school-owned resources (or super-admin shared resources) qualify.
create function public.staff_delete_library_folders(p_school uuid,p_shared boolean,p_paths jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_scope text; chosen jsonb; part jsonb; n integer; paths text[][];
 deleted_files integer; deleted_folders integer; storage_paths jsonb; wanted text[];
begin
 if auth.uid() is null or p_school is null or not coalesce(public.can_manage_school(p_school),false)
 or p_shared is null or (p_shared and not coalesce(public.is_super_admin(),false)) then
  raise exception 'Administrator access required' using errcode='42501';
 end if;
 if p_paths is null or jsonb_typeof(p_paths)<>'array' or jsonb_array_length(p_paths) not between 1 and 100 then
  raise exception 'Choose between 1 and 100 folders';
 end if;
 for chosen in select value from jsonb_array_elements(p_paths) loop
  if jsonb_typeof(chosen)<>'array' or jsonb_array_length(chosen) not between 1 and 3 then raise exception 'Invalid folder path';end if;
  n:=0;
  for part in select value from jsonb_array_elements(chosen) loop
   n:=n+1;
   if jsonb_typeof(part)<>'string' or btrim(part#>>'{}')='' or length(part#>>'{}')>(case when n=2 then 100 else 80 end)
    or (part#>>'{}') ~ '[/\\]' or (part#>>'{}') ~ '[[:cntrl:]]' then raise exception 'Invalid folder name';end if;
  end loop;
 end loop;
 v_scope:=case when p_shared then 'shared' else p_school::text end;
 perform pg_advisory_xact_lock(hashtextextended(v_scope,0));
 lock table public.hub_items in share row exclusive mode;
 with removed as (
  delete from public.hub_items i where i.kind='resource' and coalesce(i.school_id::text,'shared')=v_scope
   and exists(select 1 from jsonb_array_elements(p_paths) p(value)
    where to_jsonb((array[coalesce(nullif(i.form_level,''),'All levels'),coalesce(nullif(i.subject,''),'General'),coalesce(nullif(i.category,''),'Notes')])[1:jsonb_array_length(p.value)])=p.value)
  returning storage_path
 ) select count(*),coalesce(array_agg(storage_path),'{}'::text[]) into deleted_files,wanted from removed;
 -- Never remove a storage object still referenced by another catalog row.
 select coalesce(jsonb_agg(distinct x),'[]'::jsonb) into storage_paths from unnest(wanted) x
 where not exists(select 1 from public.hub_items i where i.storage_path=x);
 delete from public.hub_folders f where f.scope=v_scope and exists(
  select 1 from jsonb_array_elements(p_paths) p(value) where to_jsonb(f.path[1:jsonb_array_length(p.value)])=p.value);
 get diagnostics deleted_folders=row_count;
 perform public.queue_device_sync(case when p_shared then null else p_school end,null,'notes');
 return jsonb_build_object('files',deleted_files,'folders',deleted_folders,'storage_paths',storage_paths);
end $$;
revoke all on function public.staff_delete_library_folders(uuid,boolean,jsonb) from public,anon,authenticated;
grant execute on function public.staff_delete_library_folders(uuid,boolean,jsonb) to authenticated;

-- Keep the private bucket's configured ceiling consistent with dashboard validation.
update storage.buckets set file_size_limit=500000000 where id='primesecure-hub';
notify pgrst,'reload schema';
