alter table public.mku_verification_codes add column if not exists code text;
create unique index if not exists mku_verification_codes_code_key on public.mku_verification_codes (code);
grant all on public.mku_verification_codes to service_role;