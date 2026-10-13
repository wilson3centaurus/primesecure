-- Large catalog downloads continue on the self-hosted server, outside browser/request timeouts.
create table public.app_imports (
 id uuid primary key default gen_random_uuid(), school_id uuid not null references public.schools(id) on delete cascade,
 package_id text not null check(package_id ~ '^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$'), preinstall boolean not null default false,
 created_by uuid not null references public.profiles(id),
 status text not null default 'queued' check(status in ('queued','downloading','succeeded','failed')),
 detail text not null default 'Waiting for import server', item_id uuid references public.hub_items(id) on delete set null,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index app_imports_pending on public.app_imports(school_id,package_id) where status in ('queued','downloading');
create index app_imports_school_time on public.app_imports(school_id,created_at desc);
alter table public.app_imports enable row level security;
revoke all on public.app_imports from anon,authenticated;
grant select,insert(school_id,package_id,preinstall,created_by) on public.app_imports to authenticated;
create policy app_imports_read on public.app_imports for select to authenticated using(public.can_manage_school(school_id));
create policy app_imports_insert on public.app_imports for insert to authenticated with check(public.can_manage_school(school_id) and created_by=auth.uid());
