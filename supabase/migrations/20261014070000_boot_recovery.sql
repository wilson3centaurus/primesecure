-- A boot-time capability can only fetch/ack already-authorized password resets.
-- It cannot read student records or create a reset. Only its SHA256 is stored server-side.
create table public.device_recovery_channels (
 device_id uuid primary key references public.devices(id) on delete cascade,
 secret_hash text not null check(length(secret_hash)=64), registered_at timestamptz not null default now(), last_polled_at timestamptz
);
alter table public.device_recovery_channels enable row level security;
revoke all on public.device_recovery_channels from public,anon,authenticated;
create function public.device_register_recovery(p_secret text) returns jsonb language plpgsql security definer set search_path='' as $$
declare did uuid;
begin
 did:=public.current_device_id();
 if did is null or auth.uid() is null or not exists(select 1 from public.devices where id=did and status<>'retired') then raise exception 'not an enrolled device' using errcode='42501'; end if;
 if p_secret is null or p_secret !~ '^[a-f0-9]{64}$' then raise exception 'invalid recovery channel'; end if;
 insert into public.device_recovery_channels(device_id,secret_hash) values(did,encode(sha256(convert_to(p_secret,'UTF8')),'hex'))
 on conflict(device_id) do update set secret_hash=excluded.secret_hash,registered_at=now();
 return jsonb_build_object('ok',true);
end $$;
create function public.device_recovery_poll(p_device_id uuid,p_secret text) returns jsonb language plpgsql security definer set search_path='' as $$
declare channel public.device_recovery_channels; result jsonb;
begin
 if p_secret is null or length(p_secret)<>64 then raise exception 'invalid recovery channel' using errcode='42501'; end if;
 select c.* into channel from public.device_recovery_channels c join public.devices d on d.id=c.device_id
 where c.device_id=p_device_id and d.status not in ('retired','pending') and c.secret_hash=encode(sha256(convert_to(p_secret,'UTF8')),'hex') for update of c;
 if channel.device_id is null then raise exception 'invalid recovery channel' using errcode='42501'; end if;
 if channel.last_polled_at>now()-interval '10 seconds' then return jsonb_build_object('commands','[]'::jsonb); end if;
 update public.device_recovery_channels set last_polled_at=now() where device_id=p_device_id;
 update public.commands set status='failed',result='{"error":"Password reset expired"}',executed_at=now(),payload=payload-'password'
 where device_id=p_device_id and type='reset_password' and status in ('pending','delivered') and (payload->>'expires_at')::timestamptz<=now();
 with picked as (
  update public.commands set status='delivered',delivered_at=coalesce(delivered_at,now())
  where id in (select id from public.commands where device_id=p_device_id and type='reset_password' and status in ('pending','delivered') order by created_at limit 1)
  returning id,payload
 ) select coalesce(jsonb_agg(to_jsonb(picked)),'[]'::jsonb) into result from picked;
 return jsonb_build_object('commands',result);
end $$;
create function public.device_recovery_ack(p_device_id uuid,p_secret text,p_command_id uuid,p_status text,p_error text default '') returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if p_secret is null or length(p_secret)<>64 or not exists(select 1 from public.device_recovery_channels c join public.devices d on d.id=c.device_id where c.device_id=p_device_id and d.status not in ('retired','pending') and c.secret_hash=encode(sha256(convert_to(p_secret,'UTF8')),'hex')) then raise exception 'invalid recovery channel' using errcode='42501'; end if;
 if p_status not in ('succeeded','failed') or length(coalesce(p_error,''))>300 then raise exception 'invalid result'; end if;
 update public.commands set status=p_status,executed_at=now(),payload=payload-'password',result=case when p_status='succeeded' then '{"reset":true,"before_first_unlock":true}'::jsonb else jsonb_build_object('error',p_error) end
 where id=p_command_id and device_id=p_device_id and type='reset_password' and status in ('pending','delivered');
 return jsonb_build_object('ok',true);
end $$;
revoke all on function public.device_register_recovery(text),public.device_recovery_poll(uuid,text),public.device_recovery_ack(uuid,text,uuid,text,text) from public,anon,authenticated;
grant execute on function public.device_register_recovery(text) to authenticated;
grant execute on function public.device_recovery_poll(uuid,text),public.device_recovery_ack(uuid,text,uuid,text,text) to anon,authenticated;
notify pgrst,'reload schema';
