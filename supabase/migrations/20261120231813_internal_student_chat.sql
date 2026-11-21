-- Internal, school-scoped student chat. Student discovery exposes only the
-- chosen username and profile picture. Direct messages are text-only; the
-- existing support_messages channel remains the sole media-capable channel.

-- PrimeSecure predates the shared-VPS schema convention and its core device
-- tables remain in public. All new chat objects are isolated here. PostgREST's
-- shared schema list is extended additively; existing project schemas are never
-- replaced.
create schema if not exists primesecure;
revoke all on schema primesecure from public;
grant usage on schema primesecure to authenticated,service_role;

do $$
declare current_schemas text;
begin
 select split_part(setting,'=',2) into current_schemas
 from pg_roles r cross join lateral unnest(coalesce(r.rolconfig,'{}'::text[])) setting
 where r.rolname='authenticator' and setting like 'pgrst.db_schemas=%';
 if current_schemas is null or btrim(current_schemas)='' then
  current_schemas:='public,storage,graphql_public,robocore,robokorda,aura,smartschools,smartshools_erp,azim_motors,rirc_competition';
 end if;
 if not ('primesecure'=any(string_to_array(replace(current_schemas,' ',''),','))) then
  execute format('alter role authenticator set "pgrst.db_schemas" to %L',current_schemas||',primesecure');
 end if;
end $$;

create table primesecure.student_friend_requests (
 id uuid primary key default gen_random_uuid(),
 school_id uuid not null references public.schools(id) on delete cascade,
 requester_device_id uuid not null references public.devices(id) on delete cascade,
 recipient_device_id uuid not null references public.devices(id) on delete cascade,
 status text not null default 'pending' check(status in ('pending','accepted','declined','cancelled')),
 created_at timestamptz not null default now(), responded_at timestamptz,
 check(requester_device_id<>recipient_device_id)
);
create unique index student_friend_requests_one_pending_pair on primesecure.student_friend_requests
 (least(requester_device_id,recipient_device_id),greatest(requester_device_id,recipient_device_id)) where status='pending';
create index student_friend_requests_school_time on primesecure.student_friend_requests(school_id,created_at desc);
create index student_friend_requests_recipient on primesecure.student_friend_requests(recipient_device_id,status,created_at desc);

create table primesecure.student_contacts (
 id uuid primary key default gen_random_uuid(),
 school_id uuid not null references public.schools(id) on delete cascade,
 device_low_id uuid not null references public.devices(id) on delete cascade,
 device_high_id uuid not null references public.devices(id) on delete cascade,
 accepted_request_id uuid references primesecure.student_friend_requests(id) on delete set null,
 created_at timestamptz not null default now(),
 check(device_low_id<device_high_id), unique(device_low_id,device_high_id)
);
create index student_contacts_school on primesecure.student_contacts(school_id,created_at desc);

create table primesecure.student_contact_preferences (
 contact_id uuid not null references primesecure.student_contacts(id) on delete cascade,
 owner_device_id uuid not null references public.devices(id) on delete cascade,
 pinned boolean not null default false,
 friend_tag text not null default '' check(length(friend_tag)<=24),
 updated_at timestamptz not null default now(), primary key(contact_id,owner_device_id)
);

create table primesecure.student_blocks (
 blocker_device_id uuid not null references public.devices(id) on delete cascade,
 blocked_device_id uuid not null references public.devices(id) on delete cascade,
 school_id uuid not null references public.schools(id) on delete cascade,
 created_at timestamptz not null default now(),
 primary key(blocker_device_id,blocked_device_id), check(blocker_device_id<>blocked_device_id)
);
create index student_blocks_school on primesecure.student_blocks(school_id,created_at desc);

create table primesecure.student_chat_messages (
 id uuid primary key default gen_random_uuid(),
 contact_id uuid not null references primesecure.student_contacts(id) on delete cascade,
 school_id uuid not null references public.schools(id) on delete cascade,
 sender_device_id uuid not null references public.devices(id) on delete cascade,
 recipient_device_id uuid not null references public.devices(id) on delete cascade,
 body text not null check(length(btrim(body)) between 1 and 4000),
 created_at timestamptz not null default now(), read_at timestamptz,
 check(sender_device_id<>recipient_device_id)
);
create index student_chat_messages_contact_time on primesecure.student_chat_messages(contact_id,created_at desc,id);
create index student_chat_messages_recipient_unread on primesecure.student_chat_messages(recipient_device_id,created_at desc) where read_at is null;
create index student_chat_messages_school_time on primesecure.student_chat_messages(school_id,created_at desc);

create table primesecure.student_chat_presence (
 device_id uuid primary key references public.devices(id) on delete cascade,
 school_id uuid not null references public.schools(id) on delete cascade,
 last_active_at timestamptz not null default now(),
 typing_to_device_id uuid references public.devices(id) on delete set null,
 typing_at timestamptz
);
create index student_chat_presence_school_active on primesecure.student_chat_presence(school_id,last_active_at desc);

alter table primesecure.student_friend_requests enable row level security;
alter table primesecure.student_contacts enable row level security;
alter table primesecure.student_contact_preferences enable row level security;
alter table primesecure.student_blocks enable row level security;
alter table primesecure.student_chat_messages enable row level security;
alter table primesecure.student_chat_presence enable row level security;

revoke all on primesecure.student_friend_requests,primesecure.student_contacts,primesecure.student_contact_preferences,
 primesecure.student_blocks,primesecure.student_chat_messages,primesecure.student_chat_presence from public,anon,authenticated;
grant select on primesecure.student_friend_requests,primesecure.student_contacts,primesecure.student_contact_preferences,
 primesecure.student_blocks,primesecure.student_chat_messages,primesecure.student_chat_presence to authenticated;

create policy student_friend_requests_read on primesecure.student_friend_requests for select to authenticated using(
 public.can_manage_school(school_id) or requester_device_id=public.current_device_id() or recipient_device_id=public.current_device_id());
create policy student_contacts_read on primesecure.student_contacts for select to authenticated using(
 public.can_manage_school(school_id) or device_low_id=public.current_device_id() or device_high_id=public.current_device_id());
create policy student_contact_preferences_read on primesecure.student_contact_preferences for select to authenticated using(
 owner_device_id=public.current_device_id() or exists(select 1 from primesecure.student_contacts c where c.id=contact_id and public.can_manage_school(c.school_id)));
create policy student_blocks_read on primesecure.student_blocks for select to authenticated using(
 blocker_device_id=public.current_device_id() or public.can_manage_school(school_id));
create policy student_chat_messages_read on primesecure.student_chat_messages for select to authenticated using(
 public.can_manage_school(school_id) or sender_device_id=public.current_device_id() or recipient_device_id=public.current_device_id());
create policy student_chat_presence_read on primesecure.student_chat_presence for select to authenticated using(
 device_id=public.current_device_id() or public.can_manage_school(school_id) or exists(
  select 1 from primesecure.student_contacts c where
   (c.device_low_id=public.current_device_id() and c.device_high_id=device_id) or
   (c.device_high_id=public.current_device_id() and c.device_low_id=device_id)));

create function primesecure.device_chat_directory(p_query text,p_limit integer default 30) returns jsonb
language plpgsql security definer set search_path='' as $$
declare d public.devices; q text; lim integer;
begin
 select * into d from public.devices where id=public.current_device_id() and auth_user_id=auth.uid() and status='active';
 if d.id is null then raise exception 'not an active enrolled device' using errcode='42501'; end if;
 q:=btrim(coalesce(p_query,'')); lim:=least(greatest(coalesce(p_limit,30),1),50);
 if length(q)<2 or length(q)>40 then raise exception 'Enter at least two username characters' using errcode='22023'; end if;
 return jsonb_build_object('profiles',coalesce((select jsonb_agg(to_jsonb(r) order by r.username,r.device_id) from (
  select other.id device_id,s.username,s.profile_photo,
   case when b.blocker_device_id is not null then 'blocked'
        when c.id is not null then 'friend'
        when incoming.id is not null then 'incoming'
        when outgoing.id is not null then 'outgoing' else 'available' end relationship,
   coalesce(incoming.id,outgoing.id) request_id
  from public.devices other join public.student_records s on s.device_id=other.id
  left join primesecure.student_contacts c on c.device_low_id=least(d.id,other.id) and c.device_high_id=greatest(d.id,other.id)
  left join primesecure.student_blocks b on (b.blocker_device_id=d.id and b.blocked_device_id=other.id) or (b.blocker_device_id=other.id and b.blocked_device_id=d.id)
  left join primesecure.student_friend_requests incoming on incoming.requester_device_id=other.id and incoming.recipient_device_id=d.id and incoming.status='pending'
  left join primesecure.student_friend_requests outgoing on outgoing.requester_device_id=d.id and outgoing.recipient_device_id=other.id and outgoing.status='pending'
  where other.school_id=d.school_id and other.id<>d.id and other.status='active' and s.username<>''
   and s.username ilike '%'||q||'%'
  order by s.username,other.id limit lim
 ) r),'[]'::jsonb));
end $$;

create function primesecure.device_chat_presence(p_target_device_id uuid default null,p_typing boolean default false) returns jsonb
language plpgsql security definer set search_path='' as $$
declare d public.devices;
begin
 select * into d from public.devices where id=public.current_device_id() and auth_user_id=auth.uid() and status='active';
 if d.id is null then raise exception 'not an active enrolled device' using errcode='42501'; end if;
 if p_typing and (p_target_device_id is null or not exists(select 1 from primesecure.student_contacts c where
   c.device_low_id=least(d.id,p_target_device_id) and c.device_high_id=greatest(d.id,p_target_device_id))
   or exists(select 1 from primesecure.student_blocks b where
    (b.blocker_device_id=d.id and b.blocked_device_id=p_target_device_id) or (b.blocker_device_id=p_target_device_id and b.blocked_device_id=d.id))) then
  raise exception 'Chat contact unavailable' using errcode='42501';
 end if;
 insert into primesecure.student_chat_presence(device_id,school_id,last_active_at,typing_to_device_id,typing_at)
 values(d.id,d.school_id,now(),case when p_typing then p_target_device_id end,case when p_typing then now() end)
 on conflict(device_id) do update set school_id=excluded.school_id,last_active_at=now(),
  typing_to_device_id=excluded.typing_to_device_id,typing_at=excluded.typing_at;
 return jsonb_build_object('ok',true);
end $$;

create function primesecure.device_chat_action(p_action text,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare d public.devices; target public.devices; req primesecure.student_friend_requests; contact primesecure.student_contacts;
 mid uuid; rid uuid; answer jsonb; ids uuid[]; tag text;
begin
 select * into d from public.devices where id=public.current_device_id() and auth_user_id=auth.uid() and status='active' for update;
 if d.id is null then raise exception 'not an active enrolled device' using errcode='42501'; end if;
 if p_action not in ('chat_request','chat_respond','chat_cancel','chat_send','chat_read','chat_block','chat_unblock','chat_preference')
  or jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text)>10000 then raise exception 'Invalid chat action' using errcode='22023'; end if;

 if p_action='chat_request' then
  select * into target from public.devices where id=(p_payload->>'device_id')::uuid and school_id=d.school_id and status='active';
  if target.id is null or target.id=d.id or not exists(select 1 from public.student_records s where s.device_id=target.id and s.username<>'') then raise exception 'Student profile unavailable' using errcode='42501'; end if;
  if exists(select 1 from primesecure.student_blocks b where (b.blocker_device_id=d.id and b.blocked_device_id=target.id) or (b.blocker_device_id=target.id and b.blocked_device_id=d.id)) then raise exception 'Student profile unavailable' using errcode='42501'; end if;
  if exists(select 1 from primesecure.student_contacts c where c.device_low_id=least(d.id,target.id) and c.device_high_id=greatest(d.id,target.id)) then raise exception 'Already in your chat list'; end if;
  if (select count(*) from primesecure.student_friend_requests r where r.requester_device_id=d.id and r.created_at>now()-interval '1 day')>=50 then raise exception 'Daily friend request limit reached'; end if;
  insert into primesecure.student_friend_requests(school_id,requester_device_id,recipient_device_id)
   values(d.school_id,d.id,target.id) returning id into rid;
  answer:=jsonb_build_object('ok',true,'request_id',rid);

 elsif p_action='chat_respond' then
  select * into req from primesecure.student_friend_requests where id=(p_payload->>'request_id')::uuid and recipient_device_id=d.id and status='pending' for update;
  if req.id is null or coalesce(p_payload->>'response','') not in ('accepted','declined') then raise exception 'Friend request unavailable' using errcode='42501'; end if;
  if p_payload->>'response'='accepted' and exists(select 1 from primesecure.student_blocks b where
    (b.blocker_device_id=req.requester_device_id and b.blocked_device_id=req.recipient_device_id) or
    (b.blocker_device_id=req.recipient_device_id and b.blocked_device_id=req.requester_device_id)) then raise exception 'Friend request unavailable' using errcode='42501'; end if;
  update primesecure.student_friend_requests set status=p_payload->>'response',responded_at=now() where id=req.id;
  if p_payload->>'response'='accepted' then
   insert into primesecure.student_contacts(school_id,device_low_id,device_high_id,accepted_request_id)
    values(d.school_id,least(req.requester_device_id,req.recipient_device_id),greatest(req.requester_device_id,req.recipient_device_id),req.id)
    on conflict(device_low_id,device_high_id) do nothing returning id into mid;
  end if;
  answer:=jsonb_build_object('ok',true,'status',p_payload->>'response');

 elsif p_action='chat_cancel' then
  update primesecure.student_friend_requests set status='cancelled',responded_at=now()
   where id=(p_payload->>'request_id')::uuid and requester_device_id=d.id and status='pending' returning id into rid;
  if rid is null then raise exception 'Friend request unavailable' using errcode='42501'; end if;
  answer:=jsonb_build_object('ok',true);

 elsif p_action='chat_send' then
  select * into contact from primesecure.student_contacts where id=(p_payload->>'contact_id')::uuid
   and d.id in(device_low_id,device_high_id);
  if contact.id is null then raise exception 'Chat contact unavailable' using errcode='42501'; end if;
  target.id:=case when contact.device_low_id=d.id then contact.device_high_id else contact.device_low_id end;
  if exists(select 1 from primesecure.student_blocks b where (b.blocker_device_id=d.id and b.blocked_device_id=target.id) or (b.blocker_device_id=target.id and b.blocked_device_id=d.id)) then raise exception 'Chat contact unavailable' using errcode='42501'; end if;
  if (select count(*) from primesecure.student_chat_messages m where m.sender_device_id=d.id and m.created_at>now()-interval '1 day')>=500 then raise exception 'Daily chat message limit reached'; end if;
  insert into primesecure.student_chat_messages(contact_id,school_id,sender_device_id,recipient_device_id,body)
   values(contact.id,d.school_id,d.id,target.id,btrim(coalesce(p_payload->>'body',''))) returning id into mid;
  perform primesecure.device_chat_presence(target.id,false);
  answer:=jsonb_build_object('ok',true,'id',mid);

 elsif p_action='chat_read' then
  if jsonb_typeof(p_payload->'ids') is distinct from 'array' or jsonb_array_length(p_payload->'ids')>200 then raise exception 'Invalid read request'; end if;
  ids:=array(select jsonb_array_elements_text(p_payload->'ids')::uuid);
  update primesecure.student_chat_messages set read_at=coalesce(read_at,now()) where id=any(ids) and recipient_device_id=d.id;
  perform primesecure.device_chat_presence(null,false);
  answer:=jsonb_build_object('ok',true);

 elsif p_action='chat_block' then
  select * into target from public.devices where id=(p_payload->>'device_id')::uuid and school_id=d.school_id and id<>d.id;
  if target.id is null then raise exception 'Student profile unavailable' using errcode='42501'; end if;
  insert into primesecure.student_blocks(blocker_device_id,blocked_device_id,school_id) values(d.id,target.id,d.school_id) on conflict do nothing;
  update primesecure.student_friend_requests set status='cancelled',responded_at=now() where status='pending' and
   ((requester_device_id=d.id and recipient_device_id=target.id) or (requester_device_id=target.id and recipient_device_id=d.id));
  answer:=jsonb_build_object('ok',true);

 elsif p_action='chat_unblock' then
  delete from primesecure.student_blocks where blocker_device_id=d.id and blocked_device_id=(p_payload->>'device_id')::uuid;
  answer:=jsonb_build_object('ok',true);

 else
  select * into contact from primesecure.student_contacts where id=(p_payload->>'contact_id')::uuid and d.id in(device_low_id,device_high_id);
  if contact.id is null then raise exception 'Chat contact unavailable' using errcode='42501'; end if;
  tag:=btrim(coalesce(p_payload->>'tag',''));
  if length(tag)>24 then raise exception 'Friend tag is too long'; end if;
  insert into primesecure.student_contact_preferences(contact_id,owner_device_id,pinned,friend_tag)
   values(contact.id,d.id,coalesce((p_payload->>'pinned')::boolean,false),tag)
   on conflict(contact_id,owner_device_id) do update set pinned=excluded.pinned,friend_tag=excluded.friend_tag,updated_at=now();
  answer:=jsonb_build_object('ok',true);
 end if;
 return answer;
end $$;

create function primesecure.device_chat_hub() returns jsonb language plpgsql security definer set search_path='' as $$
declare d public.devices; result jsonb;
begin
 select * into d from public.devices where id=public.current_device_id() and auth_user_id=auth.uid() and status<>'retired';
 if d.id is null then raise exception 'not an enrolled device' using errcode='42501'; end if;
 select jsonb_build_object(
  'profile',coalesce((select jsonb_build_object('device_id',d.id,'username',s.username,'profile_photo',s.profile_photo) from public.student_records s where s.device_id=d.id),jsonb_build_object('device_id',d.id,'username','','profile_photo',null)),
  'contacts',coalesce((select jsonb_agg(to_jsonb(x) order by x.pinned desc,x.last_message_at desc nulls last,x.username) from (
   select c.id contact_id,other.id device_id,s.username,s.profile_photo,coalesce(pref.pinned,false) pinned,coalesce(pref.friend_tag,'') friend_tag,
    greatest(other.last_seen_at,p.last_active_at) last_seen_at,
    coalesce(p.typing_to_device_id=d.id and p.typing_at>now()-interval '8 seconds',false) typing,
    (select max(m.created_at) from primesecure.student_chat_messages m where m.contact_id=c.id) last_message_at,
    (select left(m.body,160) from primesecure.student_chat_messages m where m.contact_id=c.id order by m.created_at desc,m.id desc limit 1) last_message,
    (select count(*) from primesecure.student_chat_messages m where m.contact_id=c.id and m.recipient_device_id=d.id and m.read_at is null) unread,
    exists(select 1 from primesecure.student_blocks b where b.blocker_device_id=d.id and b.blocked_device_id=other.id) blocked_by_me,
    exists(select 1 from primesecure.student_blocks b where b.blocker_device_id=other.id and b.blocked_device_id=d.id) blocked_by_them
   from primesecure.student_contacts c
   join public.devices other on other.id=case when c.device_low_id=d.id then c.device_high_id else c.device_low_id end
   join public.student_records s on s.device_id=other.id
   left join primesecure.student_contact_preferences pref on pref.contact_id=c.id and pref.owner_device_id=d.id
   left join primesecure.student_chat_presence p on p.device_id=other.id
   where d.id in(c.device_low_id,c.device_high_id)
  ) x),'[]'::jsonb),
  'messages',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at,x.id) from (
   select m.id,m.contact_id,m.sender_device_id,m.recipient_device_id,m.body,m.created_at,m.read_at
   from primesecure.student_chat_messages m where d.id in(m.sender_device_id,m.recipient_device_id)
   order by m.created_at desc,m.id desc limit 1000
  ) x),'[]'::jsonb),
  'incoming_requests',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (
   select r.id request_id,r.requester_device_id device_id,s.username,s.profile_photo,r.status,r.created_at,r.responded_at
   from primesecure.student_friend_requests r join public.student_records s on s.device_id=r.requester_device_id
   where r.recipient_device_id=d.id order by r.created_at desc limit 100
  ) x),'[]'::jsonb),
  'outgoing_requests',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (
   select r.id request_id,r.recipient_device_id device_id,s.username,s.profile_photo,r.status,r.created_at,r.responded_at
   from primesecure.student_friend_requests r join public.student_records s on s.device_id=r.recipient_device_id
   where r.requester_device_id=d.id order by r.created_at desc limit 100
  ) x),'[]'::jsonb),
  'blocked',coalesce((select jsonb_agg(jsonb_build_object('device_id',b.blocked_device_id,'username',s.username,'profile_photo',s.profile_photo,'created_at',b.created_at) order by s.username)
   from primesecure.student_blocks b join public.student_records s on s.device_id=b.blocked_device_id where b.blocker_device_id=d.id),'[]'::jsonb)
 ) into result;
 return result;
end $$;

create function primesecure.device_offline_action(p_request_id uuid,p_action text,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare d public.devices; answer jsonb;
begin
 if p_action not like 'chat_%' then raise exception 'Invalid chat action' using errcode='22023'; end if;
 select * into d from public.devices where id=public.current_device_id() and auth_user_id=auth.uid() and status='active' for update;
 if d.id is null then raise exception 'not an active enrolled device' using errcode='42501'; end if;
 if p_request_id is null or p_action is null or jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text)>10000 then raise exception 'Invalid request'; end if;
 select result into answer from public.device_action_receipts where device_id=d.id and request_id=p_request_id;
 if found then return answer; end if;
 if (select count(*) from public.device_action_receipts where device_id=d.id and created_at>now()-interval '1 day')>=1500 then raise exception 'Daily action limit reached'; end if;
 answer:=primesecure.device_chat_action(p_action,p_payload);
 insert into public.device_action_receipts(device_id,request_id,result) values(d.id,p_request_id,answer);
 return answer;
end $$;

create function primesecure.student_chat_signal_sync() returns trigger language plpgsql security definer set search_path='' as $$
declare row_data jsonb; low_id uuid; high_id uuid;
begin
 row_data:=case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
 if tg_table_name='student_contacts' then low_id:=(row_data->>'device_low_id')::uuid;high_id:=(row_data->>'device_high_id')::uuid;
 elsif tg_table_name='student_friend_requests' then low_id:=(row_data->>'requester_device_id')::uuid;high_id:=(row_data->>'recipient_device_id')::uuid;
 elsif tg_table_name='student_chat_messages' then low_id:=(row_data->>'sender_device_id')::uuid;high_id:=(row_data->>'recipient_device_id')::uuid;
 elsif tg_table_name='student_blocks' then low_id:=(row_data->>'blocker_device_id')::uuid;high_id:=(row_data->>'blocked_device_id')::uuid;
 else return case when tg_op='DELETE' then old else new end; end if;
 perform public.queue_device_sync(null,low_id,'chat');perform public.queue_device_sync(null,high_id,'chat');
 return case when tg_op='DELETE' then old else new end;
end $$;
revoke all on function primesecure.student_chat_signal_sync() from public,anon,authenticated;
create trigger student_friend_requests_sync after insert or update on primesecure.student_friend_requests for each row execute function primesecure.student_chat_signal_sync();
create trigger student_contacts_sync after insert on primesecure.student_contacts for each row execute function primesecure.student_chat_signal_sync();
create trigger student_blocks_sync after insert or delete on primesecure.student_blocks for each row execute function primesecure.student_chat_signal_sync();
create trigger student_chat_messages_sync after insert or update of read_at on primesecure.student_chat_messages for each row execute function primesecure.student_chat_signal_sync();

revoke all on function primesecure.device_chat_directory(text,integer),primesecure.device_chat_presence(uuid,boolean),
 primesecure.device_chat_action(text,jsonb),primesecure.device_chat_hub(),primesecure.device_offline_action(uuid,text,jsonb) from public,anon;
grant execute on function primesecure.device_chat_directory(text,integer),primesecure.device_chat_presence(uuid,boolean),
 primesecure.device_chat_action(text,jsonb),primesecure.device_chat_hub(),primesecure.device_offline_action(uuid,text,jsonb) to authenticated,service_role;

do $$ begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime') then
  alter publication supabase_realtime add table primesecure.student_friend_requests,primesecure.student_contacts,primesecure.student_blocks,
   primesecure.student_chat_messages,primesecure.student_chat_presence;
 end if;
end $$;
notify pgrst,'reload config';
notify pgrst,'reload schema';
