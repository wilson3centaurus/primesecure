-- Command delivery. The agent calls device_fetch_commands() when told there is
-- work (check-in's pending_commands, or a Realtime insert on commands) and
-- reports each result with device_ack_command().

-- Hands the device its queued commands, oldest first, marking them delivered.
-- Commands already 'delivered' but never finished (agent killed mid-run) are
-- handed out again, so execution on the agent must tolerate repeats.
create function public.device_fetch_commands(p_limit int default 20)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_device uuid := public.current_device_id();
  v_result jsonb;
begin
  if v_device is null then
    raise exception 'not an enrolled device' using errcode = '42501';
  end if;

  with picked as (
    update public.commands c
       set status = 'delivered',
           delivered_at = coalesce(c.delivered_at, now())
     where c.id in (select q.id from public.commands q
                     where q.device_id = v_device and q.status in ('pending', 'delivered')
                     order by q.created_at
                     limit least(greatest(p_limit, 1), 50)
                     for update skip locked)
    returning c.id, c.type, c.payload, c.created_at
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'type', p.type, 'payload', p.payload,
                                               'created_at', p.created_at)
                            order by p.created_at), '[]'::jsonb)
    into v_result
    from picked p;

  return jsonb_build_object('commands', v_result);
end;
$$;

revoke execute on function public.device_fetch_commands(int) from public, anon;
grant execute on function public.device_fetch_commands(int) to authenticated;
