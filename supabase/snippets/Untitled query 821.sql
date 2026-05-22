delete from auth.users where email = 'maya@example.test';
delete from auth.users where id not in (select id from public.members) and email like 'eval-%@eval-test.local';