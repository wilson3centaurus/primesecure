-- Explicit read receipts, support attachments/tombstones, student bug reports,
-- and guarded form deletion. No device-control policy is changed.
revoke delete on public.school_classes from authenticated;
alter table public.support_messages drop constraint support_messages_category_check;
alter table public.support_messages add constraint support_messages_category_check check(category in ('support','name_correction','bug_report'));
alter table public.support_messages add column deleted_at timestamptz,
 add column report_details jsonb not null default '{}'::jsonb check(jsonb_typeof(report_details)='object' and octet_length(report_details::text)<=6000),
 add column report_status text not null default 'open' check(report_status in ('open','reviewing','resolved'));

create table public.communication_receipts (
 user_id uuid not null references auth.users(id) on delete cascade,
 kind text not null check(kind in ('support','reply')), message_id uuid not null,
 read_at timestamptz not null default now(), primary key(user_id,kind,message_id)
);
alter table public.communication_receipts enable row level security;
revoke all on public.communication_receipts from public,anon,authenticated;
grant select on public.communication_receipts to authenticated;
create policy communication_receipts_self on public.communication_receipts for select to authenticated using(user_id=(select auth.uid()));

create function public.communication_mark_read(p_kind text,p_ids uuid[]) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or p_kind is null or p_kind not in ('support','reply') or coalesce(cardinality(p_ids),0)>200 then raise exception 'Invalid read request' using errcode='22023'; end if;
 if p_kind='support' then
  insert into public.communication_receipts(user_id,kind,message_id)
  select auth.uid(),'support',m.id from public.support_messages m where m.id=any(p_ids) and m.deleted_at is null and
   ((m.sender='support' and m.device_id=public.current_device_id()) or (m.sender='student' and public.can_manage_school(m.school_id))) on conflict do nothing;
 else
  insert into public.communication_receipts(user_id,kind,message_id)
  select auth.uid(),'reply',r.id from public.message_replies r join public.commands c on c.id=r.command_id
   where r.id=any(p_ids) and c.deleted_at is null and public.can_view_school(r.school_id) on conflict do nothing;
 end if;
 return jsonb_build_object('ok',true);
end $$;

create function public.staff_notifications(p_school_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if auth.uid() is null or not coalesce(public.can_view_school(p_school_id),false) then raise exception 'School access required' using errcode='42501'; end if;
 with unread as (
  select 'reply'::text kind,r.id,r.device_id,r.created_at,d.student_name name,left(r.body,140) preview,'Student reply'::text title
   from public.message_replies r join public.commands c on c.id=r.command_id join public.devices d on d.id=r.device_id
   where r.school_id=p_school_id and c.deleted_at is null and not exists(select 1 from public.communication_receipts x where x.user_id=auth.uid() and x.kind='reply' and x.message_id=r.id)
  union all
  select 'support',m.id,m.device_id,m.created_at,d.student_name,left(m.body,140),case when m.category='bug_report' then 'Bug report' else 'Support message' end
   from public.support_messages m join public.devices d on d.id=m.device_id where m.school_id=p_school_id and m.sender='student' and m.deleted_at is null
   and public.can_manage_school(m.school_id) and not exists(select 1 from public.communication_receipts x where x.user_id=auth.uid() and x.kind='support' and x.message_id=m.id)
 ) select jsonb_build_object('total',(select count(*) from unread),'replies',(select count(*) from unread where kind='reply'),
 'support',(select count(*) from unread where kind='support'),'items',coalesce((select jsonb_agg(to_jsonb(t)) from (select * from unread order by created_at desc,id limit 25) t),'[]'::jsonb)) into result;
 return result;
end $$;

create function public.support_image_valid(p_image text) returns boolean language plpgsql immutable set search_path='' as $$
declare bytes bytea;
begin
 if p_image is null or p_image='' then return true; end if;
 if length(p_image)>100000 or p_image !~ '^data:image/jpeg;base64,[A-Za-z0-9+/=]+$' then return false; end if;
 bytes:=decode(substr(p_image,24),'base64');
 return octet_length(bytes) between 4 and 74980 and substring(bytes from 1 for 3)=decode('ffd8ff','hex') and substring(bytes from octet_length(bytes)-1 for 2)=decode('ffd9','hex');
exception when others then return false;
end $$;
revoke all on function public.support_image_valid(text) from public,anon,authenticated;

create function public.staff_support_post(p_device_id uuid,p_body text,p_image text default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare d public.devices; mid uuid;
begin
 select * into d from public.devices where id=p_device_id;
 if auth.uid() is null or d.id is null or not coalesce(public.can_manage_school(d.school_id),false) then raise exception 'Administrator access required' using errcode='42501'; end if;
 if length(btrim(coalesce(p_body,''))) not between 1 and 4000 or not public.support_image_valid(p_image) then raise exception 'Enter a message and a valid small JPEG image' using errcode='22023'; end if;
 insert into public.support_messages(device_id,school_id,sender,body,staff_id,attachment_data) values(d.id,d.school_id,'support',btrim(p_body),auth.uid(),nullif(p_image,'')) returning id into mid;
 return jsonb_build_object('ok',true,'id',mid);
end $$;
create or replace function public.staff_support_reply(p_device_id uuid,p_body text) returns jsonb language sql security definer set search_path='' as $$ select public.staff_support_post(p_device_id,p_body,null) $$;

create function public.support_delete_message(p_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.support_messages;
begin
 select * into m from public.support_messages where id=p_id for update;
 if auth.uid() is null or m.id is null or not(coalesce(public.can_manage_school(m.school_id),false) or coalesce(m.device_id=public.current_device_id() and m.sender='student',false)) then raise exception 'Message unavailable or not yours to delete' using errcode='42501'; end if;
 update public.support_messages set deleted_at=coalesce(deleted_at,now()),body='Message deleted',attachment_data=null,report_details='{}'::jsonb where id=m.id;
 return jsonb_build_object('ok',true);
end $$;
create function public.staff_bug_status(p_id uuid,p_status text) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or p_status not in ('open','reviewing','resolved') then raise exception 'Invalid report status' using errcode='22023'; end if;
 update public.support_messages set report_status=p_status where id=p_id and category='bug_report' and deleted_at is null and public.can_manage_school(school_id);
 if not found then raise exception 'Report unavailable' using errcode='42501'; end if;
 return jsonb_build_object('ok',true);
end $$;

alter function public.device_offline_action(uuid,text,jsonb) rename to device_offline_action_communications_base;
revoke all on function public.device_offline_action_communications_base(uuid,text,jsonb) from public,anon,authenticated,service_role;
create function public.device_offline_action(p_request_id uuid,p_action text,p_payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare d public.devices; answer jsonb; mid uuid; details jsonb; image text;
begin
 if p_action is null then raise exception 'Unsupported offline action'; end if;
 if p_action not in ('support_post','bug_report','support_delete','support_read') then return public.device_offline_action_communications_base(p_request_id,p_action,p_payload); end if;
 select * into d from public.devices where id=public.current_device_id() and auth_user_id=auth.uid() and status not in ('pending','retired') for update;
 if auth.uid() is null or d.id is null then raise exception 'not an enrolled device' using errcode='42501'; end if;
 if p_request_id is null or jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text)>115000 then raise exception 'Invalid request' using errcode='22023'; end if;
 select result into answer from public.device_action_receipts where device_id=d.id and request_id=p_request_id;
 if found then return answer; end if;
 if (select count(*) from public.device_action_receipts where device_id=d.id and created_at>now()-interval '1 day')>=1000 then raise exception 'Daily action limit reached'; end if;
 if p_action='support_delete' then answer:=public.support_delete_message((p_payload->>'id')::uuid);
 elsif p_action='support_read' then
  if jsonb_typeof(p_payload->'ids') is distinct from 'array' or jsonb_array_length(p_payload->'ids')>200 then raise exception 'Invalid read request'; end if;
  answer:=public.communication_mark_read('support',array(select jsonb_array_elements_text(p_payload->'ids')::uuid));
 else
  if (select count(*) from public.support_messages where device_id=d.id and sender='student' and created_at>now()-interval '1 day')>=50 then raise exception 'Daily support message limit reached'; end if;
  image:=nullif(p_payload->>'image',''); details:=coalesce(p_payload->'details','{}'::jsonb);
  if length(btrim(coalesce(p_payload->>'body',''))) not between 1 and 4000 or not public.support_image_valid(image) then raise exception 'Invalid message or image' using errcode='22023'; end if;
  if jsonb_typeof(details)<>'object' or octet_length(details::text)>6000 then raise exception 'Invalid report details'; end if;
  if p_action='bug_report' then
   if coalesce(details->>'category','') not in ('app','notes','wallpapers','messages','media','network','enrollment','other') or length(btrim(coalesce(details->>'steps',''))) not between 1 and 2000 then raise exception 'Choose a report category and describe the steps'; end if;
   details:=jsonb_build_object('category',details->>'category','steps',left(details->>'steps',2000),'expected',left(coalesce(details->>'expected',''),1000),'actual',left(coalesce(details->>'actual',''),1000),'agent_version',left(coalesce(details->>'agent_version',''),40),'ui_version',left(coalesce(details->>'ui_version',''),40));
  else details:='{}'::jsonb; end if;
  insert into public.support_messages(device_id,school_id,sender,category,body,attachment_data,report_details)
   values(d.id,d.school_id,'student',case when p_action='bug_report' then 'bug_report' else 'support' end,btrim(p_payload->>'body'),image,details) returning id into mid;
  answer:=jsonb_build_object('ok',true,'id',mid);
 end if;
 insert into public.device_action_receipts(device_id,request_id,result) values(d.id,p_request_id,answer);
 return answer;
end $$;

alter function public.device_hub() rename to device_hub_communications_base;
revoke all on function public.device_hub_communications_base() from public,anon,authenticated,service_role;
create function public.device_hub() returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; did uuid;
begin
 result:=public.device_hub_communications_base(); did:=public.current_device_id();
 return result || jsonb_build_object('support_messages',coalesce((select jsonb_agg(to_jsonb(t) order by t.created_at) from
  (select m.id,m.sender,m.category,m.body,m.created_at,m.attachment_data,m.deleted_at,m.report_details,m.report_status,
   exists(select 1 from public.communication_receipts x where x.user_id=auth.uid() and x.kind='support' and x.message_id=m.id) as read
   from public.support_messages m where m.device_id=did order by m.created_at desc,m.id limit 200) t),'[]'::jsonb),'communication_features',true);
end $$;

create function public.staff_delete_school_group(p_school_id uuid,p_form text,p_class text default null) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not coalesce(public.can_manage_school(p_school_id),false) then raise exception 'Administrator access required' using errcode='42501'; end if;
 perform 1 from public.schools where id=p_school_id for update;
 if exists(select 1 from public.devices where school_id=p_school_id and form_level=p_form and (p_class is null or class_name=p_class)) then raise exception 'Move assigned students to another form or class before deleting this group' using errcode='23503'; end if;
 delete from public.school_classes where school_id=p_school_id and form_level=p_form and (p_class is null or class_name=p_class);
 if not found then raise exception 'Form or class not found'; end if;
 return jsonb_build_object('ok',true);
end $$;

revoke all on function public.communication_mark_read(text,uuid[]),public.staff_notifications(uuid),public.staff_support_post(uuid,text,text),public.support_delete_message(uuid),public.staff_bug_status(uuid,text),public.device_offline_action(uuid,text,jsonb),public.device_hub(),public.staff_delete_school_group(uuid,text,text) from public,anon;
grant execute on function public.communication_mark_read(text,uuid[]),public.staff_notifications(uuid),public.staff_support_post(uuid,text,text),public.support_delete_message(uuid),public.staff_bug_status(uuid,text),public.device_offline_action(uuid,text,jsonb),public.device_hub(),public.staff_delete_school_group(uuid,text,text) to authenticated,service_role;

create function public.support_signal_sync() returns trigger language plpgsql security definer set search_path='' as $$
begin
 perform public.queue_device_sync(new.school_id,new.device_id,'support');
 return new;
end $$;
revoke all on function public.support_signal_sync() from public,anon,authenticated;
create trigger support_conversation_sync after insert or update on public.support_messages for each row execute function public.support_signal_sync();
notify pgrst,'reload schema';
