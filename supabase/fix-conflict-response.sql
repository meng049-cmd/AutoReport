-- AutoReport: return HTTP 409 for stale revisions instead of a serialization failure.
begin;
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

commit;
