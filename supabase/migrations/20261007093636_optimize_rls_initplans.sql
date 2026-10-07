-- Supabase's RLS planner can cache stable identity/admin checks when they are
-- wrapped in a scalar SELECT instead of re-evaluating them for every row.
do $$
declare
  policy_row record;
  using_expression text;
  check_expression text;
begin
  for policy_row in
    select schemaname, tablename, policyname, qual, with_check
    from pg_policies
    where schemaname = 'public'
  loop
    using_expression := replace(
      replace(policy_row.qual, 'auth.uid()', '(select auth.uid())'),
      'is_super_admin()',
      '(select public.is_super_admin())'
    );
    check_expression := replace(
      replace(policy_row.with_check, 'auth.uid()', '(select auth.uid())'),
      'is_super_admin()',
      '(select public.is_super_admin())'
    );

    if policy_row.qual is not null then
      execute format(
        'alter policy %I on %I.%I using (%s)',
        policy_row.policyname,
        policy_row.schemaname,
        policy_row.tablename,
        using_expression
      );
    end if;
    if policy_row.with_check is not null then
      execute format(
        'alter policy %I on %I.%I with check (%s)',
        policy_row.policyname,
        policy_row.schemaname,
        policy_row.tablename,
        check_expression
      );
    end if;
  end loop;
end
$$;
