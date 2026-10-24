-- AutoReport only. May use its own Supabase project or coexist with other apps.
begin;
create table if not exists public.autoreport_workspaces (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  app text not null check (app = 'autoreport'),
  revision bigint not null default 0 check (revision >= 0),
  object_path text,
  updated_at timestamptz not null default now(),
  primary key (user_id, app),
  check (object_path is null or object_path like user_id::text || '/' || app || '/%')
);
alter table public.autoreport_workspaces enable row level security;
revoke all on public.autoreport_workspaces from public, anon, authenticated;
grant select, insert, update on public.autoreport_workspaces to authenticated;
drop policy if exists autoreport_owner_select on public.autoreport_workspaces;
create policy autoreport_owner_select on public.autoreport_workspaces for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists autoreport_owner_insert on public.autoreport_workspaces;
create policy autoreport_owner_insert on public.autoreport_workspaces for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists autoreport_owner_update on public.autoreport_workspaces;
create policy autoreport_owner_update on public.autoreport_workspaces for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create or replace function public.commit_autoreport_workspace(p_app text, p_expected_revision bigint, p_object_path text)
returns bigint language plpgsql security invoker set search_path = '' as $$
declare next_revision bigint;
begin
  if auth.uid() is null or p_app <> 'autoreport' or p_expected_revision < 0
     or p_object_path not like auth.uid()::text || '/' || p_app || '/%' then
    raise exception 'Invalid workspace' using errcode = '22023';
  end if;
  if not exists (select 1 from storage.objects where bucket_id = 'autoreport-sync' and name = p_object_path) then
    raise exception 'Snapshot object does not exist' using errcode = '22023';
  end if;
  insert into public.autoreport_workspaces(user_id, app) values (auth.uid(), p_app) on conflict do nothing;
  update public.autoreport_workspaces set revision = revision + 1, object_path = p_object_path, updated_at = now()
    where user_id = auth.uid() and app = p_app and revision = p_expected_revision
    returning revision into next_revision;
  if next_revision is null then raise exception 'Workspace changed on another device' using errcode = 'PT409'; end if;
  return next_revision;
end;
$$;
revoke all on function public.commit_autoreport_workspace(text, bigint, text) from public, anon;
grant execute on function public.commit_autoreport_workspace(text, bigint, text) to authenticated;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('autoreport-sync', 'autoreport-sync', false, 52428800, array['application/json'])
on conflict (id) do nothing;
do $$
begin
  if exists (select 1 from storage.buckets where id = 'autoreport-sync' and
    (public or file_size_limit is distinct from 52428800::bigint or allowed_mime_types is distinct from array['application/json']::text[])) then
    raise exception 'Existing autoreport-sync bucket must be private, allow application/json, and have a 50 MB limit. Review bucket settings before rerunning.';
  end if;
end;
$$;
-- Never make this bucket public. The first folder is the authenticated user ID.
drop policy if exists autoreport_objects_read on storage.objects;
create policy autoreport_objects_read on storage.objects for select to authenticated
using (bucket_id = 'autoreport-sync' and (storage.foldername(name))[1] = (select auth.uid())::text and (storage.foldername(name))[2] = 'autoreport');
drop policy if exists autoreport_objects_insert on storage.objects;
create policy autoreport_objects_insert on storage.objects for insert to authenticated
with check (bucket_id = 'autoreport-sync' and (storage.foldername(name))[1] = (select auth.uid())::text and (storage.foldername(name))[2] = 'autoreport');
drop policy if exists autoreport_objects_delete on storage.objects;
create policy autoreport_objects_delete on storage.objects for delete to authenticated
using (bucket_id = 'autoreport-sync' and (storage.foldername(name))[1] = (select auth.uid())::text and (storage.foldername(name))[2] = 'autoreport');

commit;
