-- One idempotent staff operation for technician-assisted PC enrollment.
-- Device table column grants remain unchanged.
create or replace function public.staff_prepare_student(
 p_request_id uuid, p_school uuid, p_student_name text, p_form_level text, p_class_name text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare d public.devices;
begin
 if auth.uid() is null or not public.can_manage_school(p_school) then
  raise exception 'School administrator access required' using errcode='42501';
 end if;
 if p_request_id is null or p_student_name is null or length(btrim(p_student_name)) not between 2 and 160
  or p_form_level is null or p_class_name is null or length(btrim(p_class_name))=0 then
  raise exception 'Enter a student name and select a school class' using errcode='22023';
 end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_request_id::text,917));
 select * into d from public.devices where id=p_request_id;
 if found then
  if d.school_id<>p_school then raise exception 'Request belongs to another school' using errcode='42501';end if;
 else
  if not exists(select 1 from public.school_classes where school_id=p_school and form_level=p_form_level and class_name=p_class_name) then
   raise exception 'Class no longer exists; refresh classes' using errcode='22023';
  end if;
  insert into public.devices(id,school_id,student_name,form_level,class_name)
   values(p_request_id,p_school,btrim(p_student_name),p_form_level,p_class_name) returning * into d;
 end if;
 return jsonb_build_object('id',d.id,'school_id',d.school_id,'student_name',d.student_name,'student_id',d.student_id,
  'enroll_token',d.enroll_token,'status',d.status,'enrolled_at',d.enrolled_at,'auth_user_id',d.auth_user_id,'serial',d.serial);
end;
$$;
revoke all on function public.staff_prepare_student(uuid,uuid,text,text,text) from public,anon;
grant execute on function public.staff_prepare_student(uuid,uuid,text,text,text) to authenticated;
notify pgrst,'reload schema';
