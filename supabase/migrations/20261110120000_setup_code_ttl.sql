-- Setup codes with a caller-chosen lifetime, for the RoboKorda Authenticator.
-- The 6-digit code and 15-minute default of staff_issue_school_setup_code(uuid)
-- are unchanged; the dashboard keeps using that one. This overload lets the
-- Authenticator request 30-second codes. device-setup already rejects any code
-- whose expires_at has passed, so the shorter lifetime is enforced server-side.
create or replace function public.staff_issue_school_setup_code(p_school uuid, p_ttl_seconds integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_code text; v_hash text; v_id uuid; v_exp timestamptz; tries integer:=0;
begin
  if auth.uid() is null or not public.can_manage_school(p_school) then
    raise exception 'School administrator access required' using errcode='42501';
  end if;
  p_ttl_seconds:=greatest(15,least(coalesce(p_ttl_seconds,900),900));
  v_exp:=now()+make_interval(secs=>p_ttl_seconds);
  -- Short codes rotate constantly; drop long-dead unclaimed ones.
  delete from public.school_setup_codes
   where school_id=p_school and used_at is null and claimed_at is null
     and expires_at<now()-interval '1 hour';
  loop
    tries:=tries+1;
    v_code:=lpad(((('x'||substr(replace(gen_random_uuid()::text,'-',''),1,8))::bit(32)::bigint % 1000000))::text,6,'0');
    v_hash:=encode(extensions.digest(v_code,'sha256'),'hex');
    begin
      insert into public.school_setup_codes(school_id,code_hash,expires_at) values(p_school,v_hash,v_exp) returning id into v_id;
      exit;
    exception when unique_violation then
      if tries>=8 then raise exception 'Could not issue a unique setup code'; end if;
    end;
  end loop;
  return jsonb_build_object('id',v_id,'code',v_code,'expires_at',v_exp);
end;
$$;

revoke all on function public.staff_issue_school_setup_code(uuid,integer) from public,anon;
grant execute on function public.staff_issue_school_setup_code(uuid,integer) to authenticated,service_role;
notify pgrst,'reload schema';
