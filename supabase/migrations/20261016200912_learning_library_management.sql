-- Learning requests use the existing device outbox and staff review permissions.
alter table public.hub_requests add column kind text not null default 'app' check(kind in ('app','resource')),
 add column resource_type text not null default '', add column form_level text not null default '', add column subject text not null default '';
alter function public.device_offline_action(uuid,text,jsonb) rename to device_offline_action_library_base;
revoke all on function public.device_offline_action_library_base(uuid,text,jsonb) from public,anon,authenticated,service_role;
create function public.device_offline_action(p_request_id uuid,p_action text,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare d public.devices; answer jsonb;
begin
 if p_action is distinct from 'request_resource' then return public.device_offline_action_library_base(p_request_id,p_action,p_payload); end if;
 select * into d from public.devices where auth_user_id=auth.uid() and auth.uid() is not null and status='active' for update;
 if d.id is null then raise exception 'not an active enrolled device' using errcode='42501'; end if;
 if p_request_id is null or p_payload is null or jsonb_typeof(p_payload)<>'object' or octet_length(p_payload::text)>6000 then raise exception 'Invalid learning request'; end if;
 select result into answer from public.device_action_receipts where device_id=d.id and request_id=p_request_id;
 if found then return answer; end if;
 if coalesce(length(btrim(p_payload->>'name')),0) not between 1 and 160
 or length(coalesce(p_payload->>'reason',''))>1000 or length(coalesce(p_payload->>'form_level',''))>80 or length(coalesce(p_payload->>'subject',''))>100
 or coalesce(p_payload->>'resource_type','') not in ('Book','Notes','Past exam papers','Novel','Textbook','Images','Other resources') then raise exception 'Invalid learning request'; end if;
 if (select count(*) from public.hub_requests where device_id=d.id and created_at>now()-interval '1 day')>=10 then raise exception 'Daily request limit reached'; end if;
 insert into public.hub_requests(device_id,school_id,name,reason,kind,resource_type,form_level,subject)
 values(d.id,d.school_id,btrim(p_payload->>'name'),coalesce(p_payload->>'reason',''),'resource',p_payload->>'resource_type',coalesce(p_payload->>'form_level',''),coalesce(p_payload->>'subject','')) returning jsonb_build_object('ok',true,'id',id) into answer;
 insert into public.device_action_receipts(device_id,request_id,result) values(d.id,p_request_id,answer);
 return answer;
end $$;
revoke all on function public.device_offline_action(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.device_offline_action(uuid,text,jsonb) to authenticated;
alter function public.device_hub() rename to device_hub_library_base;
revoke all on function public.device_hub_library_base() from public,anon,authenticated,service_role;
create function public.device_hub() returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; did uuid;
begin
 result:=public.device_hub_library_base(); did:=public.current_device_id();
 return result||jsonb_build_object('resource_requests',coalesce((select jsonb_agg(to_jsonb(r)) from
 (select name,reason,status,created_at,resource_type,form_level,subject from public.hub_requests where device_id=did and kind='resource' order by created_at desc limit 30) r),'[]'::jsonb));
end $$;
revoke all on function public.device_hub() from public,anon,authenticated;
grant execute on function public.device_hub() to authenticated;

-- Folders mirror the existing Form / Subject / Resource-folder hierarchy.
create table public.hub_folders (
 id uuid primary key default gen_random_uuid(), school_id uuid references public.schools(id) on delete cascade,
 scope text not null, path text[] not null,
 check(scope=coalesce(school_id::text,'shared')),
 check(cardinality(path) between 1 and 3),
 check(array_position(path,null) is null),
 unique(scope,path)
);
alter table public.hub_folders enable row level security;
revoke all on public.hub_folders from public,anon,authenticated;
grant select on public.hub_folders to authenticated;
create policy hub_folders_read on public.hub_folders for select to authenticated using
 ((school_id is null and public.is_super_admin()) or public.can_view_school(school_id));
-- Seed existing class forms; no resources are moved or deleted.
insert into public.hub_folders(school_id,scope,path) select distinct school_id,school_id::text,array[form_level] from public.school_classes where btrim(form_level)<>'' on conflict do nothing;
create function public.staff_library_folder(p_school uuid,p_shared boolean,p_action text,p_path text[],p_name text default '') returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_scope text; dest text[]; n integer; moved integer;
begin
 if auth.uid() is null or p_school is null or not coalesce(public.can_manage_school(p_school),false)
 or p_shared is null or (p_shared and not coalesce(public.is_super_admin(),false)) then raise exception 'Administrator access required' using errcode='42501'; end if;
 v_scope:=case when p_shared then 'shared' else p_school::text end;
 if p_action is null or p_action not in ('create','rename','delete') or p_path is null or cardinality(p_path) not between 1 and 3 or array_ndims(p_path)<>1
 or array_position(p_path,null) is not null or exists(select 1 from unnest(p_path) x where btrim(x)='' or length(x)>(case when array_position(p_path,x)=2 then 100 else 80 end) or x ~ '[/\\]') then raise exception 'Choose a valid folder path'; end if;
 perform pg_advisory_xact_lock(hashtextextended(v_scope,0)); n:=cardinality(p_path);
 if p_action='create' then
  for i in 1..n loop insert into public.hub_folders(school_id,scope,path) values(case when p_shared then null else p_school end,v_scope,p_path[1:i]) on conflict do nothing; end loop;
 elsif p_action='delete' then
  if exists(select 1 from public.hub_items where kind='resource' and coalesce(school_id::text,'shared')=v_scope
   and (array[coalesce(nullif(form_level,''),'All levels'),coalesce(nullif(subject,''),'General'),coalesce(nullif(category,''),'Notes')])[1:n]=p_path)
  then raise exception 'This folder contains files. Move them before deleting it.'; end if;
  delete from public.hub_folders where scope=v_scope and path[1:n]=p_path;
 else
  if btrim(coalesce(p_name,''))='' or length(p_name)>(case when n=2 then 100 else 80 end) or p_name ~ '[/\\]' then raise exception 'Enter a valid folder name'; end if;
  dest:=p_path;dest[n]:=btrim(p_name);
  if dest=p_path then return jsonb_build_object('ok',true); end if;
  if exists(select 1 from public.hub_folders where scope=v_scope and path[1:n]=dest)
   or exists(select 1 from public.hub_items where kind='resource' and coalesce(school_id::text,'shared')=v_scope and (array[coalesce(nullif(form_level,''),'All levels'),coalesce(nullif(subject,''),'General'),coalesce(nullif(category,''),'Notes')])[1:n]=dest)
  then raise exception 'A folder with this name already exists'; end if;
  update public.hub_items set form_level=case when n=1 then btrim(p_name) else form_level end,subject=case when n=2 then btrim(p_name) else subject end,category=case when n=3 then btrim(p_name) else category end
   where kind='resource' and coalesce(school_id::text,'shared')=v_scope and (array[coalesce(nullif(form_level,''),'All levels'),coalesce(nullif(subject,''),'General'),coalesce(nullif(category,''),'Notes')])[1:n]=p_path;
  update public.hub_folders set path=dest||coalesce(path[n+1:cardinality(path)],'{}'::text[]) where scope=v_scope and path[1:n]=p_path;
  for i in 1..n loop insert into public.hub_folders(school_id,scope,path) values(case when p_shared then null else p_school end,v_scope,dest[1:i]) on conflict do nothing; end loop;
 end if;
 perform public.queue_device_sync(case when p_shared then null else p_school end,null,'notes');
 return jsonb_build_object('ok',true);
end $$;
revoke all on function public.staff_library_folder(uuid,boolean,text,text[],text) from public,anon,authenticated;
grant execute on function public.staff_library_folder(uuid,boolean,text,text[],text) to authenticated;
notify pgrst,'reload schema';
