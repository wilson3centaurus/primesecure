-- File browser + web filtering.
--
-- list_files: the agent answers with a directory listing in the command's
-- result, which the dashboard's file browser renders.
-- Web filtering lives in the policy: the agent enforces it in Chrome (managed
-- configuration) and in its own School Browser.

alter table public.commands drop constraint commands_type_check;
alter table public.commands add constraint commands_type_check check (type in (
  'message', 'install_apk', 'remove_apk', 'push_file', 'delete_file', 'list_files',
  'locate', 'suspend', 'unsuspend', 'lock', 'unlock', 'retire'));

alter table public.policies
  add column web_filter       text    not null default 'off' check (web_filter in ('off', 'blocklist', 'allowlist')),
  add column web_blocklist    text[]  not null default '{}',
  add column web_allowlist    text[]  not null default '{}',
  add column safe_search      boolean not null default false,
  add column browser_home_url text check (browser_home_url ~ '^https?://');

create or replace function public.effective_policy(p_device_id uuid)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(
    (select jsonb_build_object(
              'id', p.id,
              'scope', case when p.device_id is null then 'school' else 'device' end,
              'wallpaper_url', p.wallpaper_url,
              'lock_wallpaper', p.lock_wallpaper,
              'block_installs', p.block_installs,
              'hide_settings', p.hide_settings,
              'hidden_apps', to_jsonb(p.hidden_apps),
              'allowed_apps', to_jsonb(p.allowed_apps),
              'web_filter', p.web_filter,
              'web_blocklist', to_jsonb(p.web_blocklist),
              'web_allowlist', to_jsonb(p.web_allowlist),
              'safe_search', p.safe_search,
              'browser_home_url', p.browser_home_url,
              'updated_at', p.updated_at)
       from public.policies p
       join public.devices d on d.id = p_device_id
      where p.device_id = d.id or (p.device_id is null and p.school_id = d.school_id)
      order by (p.device_id is null)  -- device override first
      limit 1),
    '{}'::jsonb)
$$;
