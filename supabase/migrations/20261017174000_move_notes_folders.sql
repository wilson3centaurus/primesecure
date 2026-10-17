-- Folder moves preserve the fixed Form / Subject / Resource hierarchy and scope.
create function public.staff_move_library_folder(p_school uuid,p_shared boolean,p_path text[],p_target text[]) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_scope text; n integer;
begin
 if auth.uid() is null or p_school is null or not coalesce(public.can_manage_school(p_school),false)
 or p_shared is null or (p_shared and not coalesce(public.is_super_admin(),false)) then raise exception 'Administrator access required' using errcode='42501'; end if;
 v_scope:=case when p_shared then 'shared' else p_school::text end;
 n:=cardinality(p_path);
 if p_path is null or p_target is null or n not between 2 and 3 or cardinality(p_target)<>n
 or array_ndims(p_path)<>1 or array_ndims(p_target)<>1 or array_lower(p_path,1)<>1 or array_lower(p_target,1)<>1
 or exists(select 1 from unnest(p_path||p_target) with ordinality as t(x,i) where x is null or btrim(x)='' or x<>btrim(x) or length(x)>case when (i-1)%n=1 then 100 else 80 end or x ~ '[/\\]')
 then raise exception 'Choose valid folders at the same level'; end if;
 perform pg_advisory_xact_lock(hashtextextended(v_scope,0));
 if p_path=p_target then return jsonb_build_object('ok',true); end if;
 if not exists(select 1 from public.hub_folders where scope=v_scope and path[1:n]=p_path)
 and not exists(select 1 from public.hub_items where kind='resource' and coalesce(school_id::text,'shared')=v_scope and (array[coalesce(nullif(form_level,''),'All levels'),coalesce(nullif(subject,''),'General'),coalesce(nullif(category,''),'Notes')])[1:n]=p_path)
 then raise exception 'Source folder not found in this library'; end if;
 if exists(select 1 from public.hub_folders where scope=v_scope and path[1:n]=p_target)
 or exists(select 1 from public.hub_items where kind='resource' and coalesce(school_id::text,'shared')=v_scope and (array[coalesce(nullif(form_level,''),'All levels'),coalesce(nullif(subject,''),'General'),coalesce(nullif(category,''),'Notes')])[1:n]=p_target)
 then raise exception 'A destination folder with this name already exists'; end if;
 update public.hub_items set form_level=p_target[1],subject=p_target[2],category=case when n=3 then p_target[3] else category end
 where kind='resource' and coalesce(school_id::text,'shared')=v_scope and (array[coalesce(nullif(form_level,''),'All levels'),coalesce(nullif(subject,''),'General'),coalesce(nullif(category,''),'Notes')])[1:n]=p_path;
 update public.hub_folders set path=p_target||coalesce(path[n+1:cardinality(path)],'{}'::text[]) where scope=v_scope and path[1:n]=p_path;
 for i in 1..n loop insert into public.hub_folders(school_id,scope,path) values(case when p_shared then null else p_school end,v_scope,p_target[1:i]) on conflict do nothing; end loop;
 perform public.queue_device_sync(case when p_shared then null else p_school end,null,'notes');
 return jsonb_build_object('ok',true);
end $$;
revoke all on function public.staff_move_library_folder(uuid,boolean,text[],text[]) from public,anon,authenticated;
grant execute on function public.staff_move_library_folder(uuid,boolean,text[],text[]) to authenticated;
notify pgrst,'reload schema';
