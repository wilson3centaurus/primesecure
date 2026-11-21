-- Let authorised school managers see only the enrolled student's receipt for
-- a support reply. This powers truthful delivered/read ticks without exposing
-- unrelated users' communication receipts.
drop policy if exists communication_receipts_school_support_reads on public.communication_receipts;
create policy communication_receipts_school_support_reads
on public.communication_receipts
for select
to authenticated
using (
  kind = 'support'
  and exists (
    select 1
    from public.support_messages m
    join public.devices d on d.id = m.device_id
    where m.id = communication_receipts.message_id
      and m.sender = 'support'
      and d.auth_user_id = communication_receipts.user_id
      and public.can_manage_school(m.school_id)
  )
);
