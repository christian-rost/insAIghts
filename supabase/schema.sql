create extension if not exists pgcrypto;

create table if not exists insaights_users (
  id uuid primary key default gen_random_uuid(),
  username text not null unique,
  email text not null unique,
  password_hash text not null,
  roles text[] not null default array['AP_CLERK']::text[],
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists insaights_admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  actor_user_id uuid,
  target_type text,
  target_id text,
  metadata_json jsonb not null default '{}'::jsonb,
  diff_before jsonb,
  diff_after jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_insaights_admin_audit_log_actor on insaights_admin_audit_log(actor_user_id);
create index if not exists idx_insaights_admin_audit_log_created on insaights_admin_audit_log(created_at desc);

create table if not exists insaights_config_connectors (
  id uuid primary key default gen_random_uuid(),
  connector_name text not null unique check (connector_name in ('mail', 'rest', 'minio')),
  enabled boolean not null default false,
  schedule_cron text,
  poll_interval_seconds integer not null default 300,
  retry_max_attempts integer not null default 3,
  retry_backoff_seconds integer not null default 30,
  timeout_seconds integer not null default 60,
  config_json jsonb not null default '{}'::jsonb,
  updated_by uuid,
  updated_at timestamptz not null default now()
);

insert into insaights_config_connectors (connector_name, enabled)
values ('mail', false), ('rest', false), ('minio', false)
on conflict (connector_name) do nothing;

create table if not exists insaights_documents (
  id uuid primary key default gen_random_uuid(),
  source_system text not null,
  source_uri text not null unique,
  filename text not null,
  file_type text not null,
  file_size_bytes bigint not null default 0,
  status text not null default 'INGESTED',
  raw_metadata_json jsonb not null default '{}'::jsonb,
  extracted_text text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_insaights_documents_source on insaights_documents(source_system);
create index if not exists idx_insaights_documents_created on insaights_documents(created_at desc);
