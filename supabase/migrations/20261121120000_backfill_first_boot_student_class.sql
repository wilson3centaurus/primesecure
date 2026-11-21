-- Keep the current dashboard fields and the first-boot compatibility fields aligned.
update public.devices
set form_level = 'Form ' || class_form,
    class_name = class_section
where class_form between 1 and 6
  and class_section ~ '^[A-Z]{1,4}$'
  and (btrim(coalesce(form_level, '')) = '' or btrim(coalesce(class_name, '')) = '');

insert into public.school_classes(school_id, form_level, class_name)
select distinct school_id, 'Form ' || class_form, class_section
from public.devices
where class_form between 1 and 6 and class_section ~ '^[A-Z]{1,4}$'
on conflict do nothing;
