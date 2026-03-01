-- Purpose:
-- Revert insAIghts-specific changes on shared legacy table `app_users`.
-- This script is safe to run multiple times.

-- 1) If legacy table has `is_admin`, map ADMIN role back to legacy boolean.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_name = 'app_users' and column_name = 'is_admin'
  ) and exists (
    select 1 from information_schema.columns
    where table_name = 'app_users' and column_name = 'roles'
  ) then
    execute $q$
      update app_users
      set is_admin = coalesce(is_admin, false) or ('ADMIN' = any(roles))
    $q$;
  end if;
end $$;

-- 2) Remove insAIghts role column from shared legacy table.
alter table if exists app_users
drop column if exists roles;

-- 3) Optional cleanup if these columns were added only for insAIghts in this DB.
-- Uncomment only if your legacy app_users really does not use these fields.
-- alter table if exists app_users drop column if exists updated_at;

