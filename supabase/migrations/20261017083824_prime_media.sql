-- School media files reuse private hub storage and school opt-in access.
alter table public.hub_items drop constraint hub_items_kind_check;
alter table public.hub_items add constraint hub_items_kind_check check(kind in ('resource','wallpaper','app','media'));
alter table public.hub_items add constraint hub_media_type check(kind<>'media' or (mime_type in ('audio/mpeg','audio/mp4','audio/ogg','audio/wav','video/mp4','video/webm') and size<=250000000));
create table public.prime_media_settings (
 school_id uuid primary key references public.schools(id) on delete cascade,
 enabled boolean not null default true,
 youtube_search boolean not null default false,
 channels jsonb not null default '[]' check(jsonb_typeof(channels)='array' and jsonb_array_length(channels)<=20 and length(channels::text)<=5000)
);
create table public.prime_media_videos (
 id uuid primary key default gen_random_uuid(),
 school_id uuid not null references public.schools(id) on delete cascade,
 video_id text not null check(video_id ~ '^[A-Za-z0-9_-]{11}$'),
 title text not null check(length(trim(title)) between 1 and 160),
 channel text not null default '' check(length(channel)<=160),
 category text not null default 'Learning' check(category in ('Learning','Music','Robotics','Science','Languages','Other')),
 published boolean not null default true,
 created_at timestamptz not null default now(),
 unique(school_id,video_id)
);
alter table public.prime_media_settings enable row level security;
alter table public.prime_media_videos enable row level security;
revoke all on public.prime_media_settings,public.prime_media_videos from anon,authenticated;
grant select,insert,update,delete on public.prime_media_settings,public.prime_media_videos to authenticated;
create policy media_settings_read on public.prime_media_settings for select to authenticated using(public.can_view_school(school_id));
create policy media_settings_write on public.prime_media_settings for all to authenticated using(public.can_manage_school(school_id)) with check(public.can_manage_school(school_id));
create policy media_videos_read on public.prime_media_videos for select to authenticated using(public.can_view_school(school_id));
create policy media_videos_write on public.prime_media_videos for all to authenticated using(public.can_manage_school(school_id)) with check(public.can_manage_school(school_id));
create trigger prime_media_settings_sync after insert or update or delete on public.prime_media_settings for each row execute function public.signal_device_sync();
create trigger prime_media_videos_sync after insert or update or delete on public.prime_media_videos for each row execute function public.signal_device_sync();

create function public.device_prime_media() returns jsonb language plpgsql security definer set search_path='' as $$
declare d public.devices; cfg public.prime_media_settings;
begin
 select * into d from public.devices where id=public.current_device_id() and auth_user_id=auth.uid() and status='active';
 if d.id is null then raise exception 'not an active enrolled device' using errcode='42501';end if;
 select * into cfg from public.prime_media_settings where school_id=d.school_id;
 return jsonb_build_object('enabled',coalesce(cfg.enabled,true),'youtube_search',coalesce(cfg.enabled,true) and coalesce(cfg.youtube_search,false),'channels',coalesce(cfg.channels,'[]'::jsonb),
 'videos',case when coalesce(cfg.enabled,true) then coalesce((select jsonb_agg(to_jsonb(v) order by v.title) from public.prime_media_videos v where school_id=d.school_id and published),'[]'::jsonb) else '[]'::jsonb end);
end $$;
revoke all on function public.device_prime_media() from public,anon;
grant execute on function public.device_prime_media() to authenticated;

-- Only the server search route spends this budget; devices cannot reset it.
create table public.prime_media_search_budget (
 school_id uuid not null references public.schools(id) on delete cascade,
 day date not null default current_date,
 calls integer not null default 0,
 primary key(school_id,day)
);
alter table public.prime_media_search_budget enable row level security;
revoke all on public.prime_media_search_budget from public,anon,authenticated;
create function public.device_prime_media_search_gate(p_channel text default '') returns jsonb language plpgsql security definer set search_path='' as $$
declare cfg jsonb; sid uuid; total integer;
begin
 cfg:=public.device_prime_media();
 if not (cfg->>'youtube_search')::boolean then raise exception 'YouTube search is not enabled by your school' using errcode='42501';end if;
 if jsonb_array_length(cfg->'channels')>0 and not exists(select 1 from jsonb_array_elements(cfg->'channels') c where c->>'id'=p_channel) then raise exception 'Choose a school-approved channel' using errcode='42501';end if;
 select school_id into sid from public.devices where id=public.current_device_id();
 insert into public.prime_media_search_budget(school_id,day,calls) values(sid,current_date,1)
 on conflict(school_id,day) do update set calls=public.prime_media_search_budget.calls+1 where public.prime_media_search_budget.calls<80 returning calls into total;
 if total is null then raise exception 'The school search budget is used for today. Browse the approved library instead.' using errcode='P0001';end if;
 delete from public.prime_media_search_budget where school_id=sid and day<current_date-7;
 return cfg;
end $$;
-- The route calls with the device JWT, so ownership checks remain in force.
revoke all on function public.device_prime_media_search_gate(text) from public,anon;
grant execute on function public.device_prime_media_search_gate(text) to authenticated;

alter function public.device_hub() rename to device_hub_prime_media_base;
revoke all on function public.device_hub_prime_media_base() from public,anon,authenticated,service_role;
create function public.device_hub() returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; cfg jsonb;
begin
 result:=public.device_hub_prime_media_base();
 if exists(select 1 from public.devices where id=public.current_device_id() and status='active') then cfg:=public.device_prime_media();
 else cfg:=jsonb_build_object('enabled',false,'youtube_search',false,'channels','[]'::jsonb,'videos','[]'::jsonb);end if;
 result:=result||jsonb_build_object('prime_media',cfg);
 if not (cfg->>'enabled')::boolean then result:=jsonb_set(result,'{items}',coalesce((select jsonb_agg(i) from jsonb_array_elements(result->'items') i where i->>'kind'<>'media'),'[]'::jsonb));end if;
 return result;
end $$;
revoke all on function public.device_hub() from public,anon;
grant execute on function public.device_hub() to authenticated,service_role;
notify pgrst,'reload schema';

create or replace function public.hub_can_read(p_item uuid) returns boolean
language sql stable security definer set search_path = '' as $$
 select auth.uid() is not null and exists (
 select 1 from public.hub_items i where i.id=p_item and (
 public.can_view_school(i.school_id) or (i.school_id is null and public.auth_role() is not null)
 or (i.published and (i.kind<>'media' or not exists(select 1 from public.prime_media_settings m where m.school_id=(select school_id from public.devices where auth_user_id=auth.uid()) and not m.enabled)) and exists(select 1 from public.devices d where d.auth_user_id=auth.uid() and d.status <> 'retired'
 and (i.school_id=d.school_id or (i.school_id is null and (exists(select 1 from public.hub_access a where a.item_id=i.id and a.school_id=d.school_id)
 or (i.kind='wallpaper' and exists(select 1 from public.hub_settings s where s.default_wallpaper_id=i.id and (s.scope='global' or s.school_id=d.school_id))))))))
 ))
$$;
