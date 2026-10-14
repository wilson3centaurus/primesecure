-- Complete receipts and whole-broadcast deletion at fleet scale.
create or replace function public.staff_delete_messages(p_ids uuid[]) returns jsonb language plpgsql security definer set search_path='' as $$
declare changed integer;
begin
 if auth.uid() is null or public.auth_role() is null or coalesce(cardinality(p_ids),0) not between 1 and 500 then raise exception 'Invalid message selection' using errcode='42501'; end if;
 if exists(select 1 from unnest(p_ids) wanted(id) left join public.commands c on c.id=wanted.id
  where c.id is null or c.type<>'message' or not coalesce(public.can_manage_school(c.school_id) or (public.can_view_school(c.school_id) and c.created_by=auth.uid()),false))
 then raise exception 'You cannot delete these messages' using errcode='42501'; end if;
 -- Expand selected representatives to their whole broadcast, within the same
 -- school and sender. Pagination must never leave half a notice undeleted.
 select array_agg(distinct c.id) into p_ids from public.commands c where c.id=any(p_ids) or exists(
  select 1 from public.commands seed where seed.id=any(p_ids) and seed.type='message'
  and seed.school_id=c.school_id and seed.created_by is not distinct from c.created_by
  and seed.payload->>'broadcast_id' is not null and c.payload->>'broadcast_id'=seed.payload->>'broadcast_id');
 perform 1 from public.commands where id=any(p_ids) for update;
 if exists(select 1 from unnest(p_ids) wanted(id) left join public.commands c on c.id=wanted.id
  where c.id is null or c.type<>'message' or not coalesce(public.can_manage_school(c.school_id) or (public.can_view_school(c.school_id) and c.created_by=auth.uid()),false))
 then raise exception 'You cannot delete these messages' using errcode='42501'; end if;
 update public.commands set deleted_at=now(),status='cancelled' where id=any(p_ids) and deleted_at is null;
 get diagnostics changed=row_count;
 return jsonb_build_object('deleted',changed);
end $$;
revoke all on function public.staff_delete_messages(uuid[]) from public,anon;
grant execute on function public.staff_delete_messages(uuid[]) to authenticated,service_role;

create index commands_notice_batch on public.commands(school_id,(coalesce(payload->>'broadcast_id',id::text)),created_by) where type='message' and deleted_at is null;
-- Aggregate in Postgres: full 300-device receipts, one copy of each message body.
create function public.staff_message_history(p_school_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if auth.uid() is null or public.auth_role() is null or not public.can_view_school(p_school_id) then raise exception 'School staff access required' using errcode='42501'; end if;
 with batches as (
  select coalesce(payload->>'broadcast_id',id::text) batch,created_by,min(id::text) representative,max(created_at) sent
  from public.commands where school_id=p_school_id and type='message' and deleted_at is null
  group by coalesce(payload->>'broadcast_id',id::text),created_by order by max(created_at) desc limit 25
 ) select coalesce(jsonb_agg(jsonb_build_object('id',b.representative,'created_by',b.created_by,'created_at',b.sent,
  'title',coalesce(first.payload->>'title','School message'),'body',coalesce(first.payload->>'body',''),
  'receipts',(select jsonb_agg(jsonb_build_object('id',c.id,'device_id',c.device_id,'name',d.student_name,'student_id',d.student_id,'status',c.status,'seen_at',c.seen_at,'acknowledged_at',c.acknowledged_at) order by d.student_name)
   from public.commands c join public.devices d on d.id=c.device_id where c.school_id=p_school_id and c.type='message' and c.deleted_at is null
   and coalesce(c.payload->>'broadcast_id',c.id::text)=b.batch and c.created_by is not distinct from b.created_by)) order by b.sent desc),'[]'::jsonb)
 into result from batches b join public.commands first on first.id=b.representative::uuid;
 return result;
end $$;
revoke all on function public.staff_message_history(uuid) from public,anon;
grant execute on function public.staff_message_history(uuid) to authenticated,service_role;

notify pgrst, 'reload schema';
