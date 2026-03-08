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

create table if not exists insaights_config_workflow_rules (
  id uuid primary key default gen_random_uuid(),
  rule_name text not null unique,
  rules_json jsonb not null default '{}'::jsonb,
  updated_by uuid,
  updated_at timestamptz not null default now()
);

insert into insaights_config_workflow_rules (rule_name, rules_json)
values (
  'invoice_approval',
  '{
    "approval": {
      "four_eyes": false,
      "require_validated_status": false,
      "amount_limits": [
        {"max_amount": 1000, "allowed_roles": ["AP_CLERK", "APPROVER", "ADMIN"]},
        {"max_amount": 10000, "allowed_roles": ["APPROVER", "ADMIN"]},
        {"max_amount": null, "allowed_roles": ["ADMIN"]}
      ],
      "supplier_role_overrides": []
    }
  }'::jsonb
)
on conflict (rule_name) do nothing;

create table if not exists insaights_config_graph (
  id uuid primary key default gen_random_uuid(),
  config_name text not null unique,
  config_json jsonb not null default '{}'::jsonb,
  updated_by uuid,
  updated_at timestamptz not null default now()
);

insert into insaights_config_graph (config_name, config_json)
values (
  'invoice_data_layer',
  '{"data_layer_fields": ["supplier_name", "currency", "status", "empfaenger"]}'::jsonb
)
on conflict (config_name) do nothing;

create table if not exists insaights_recipient_aliases (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null default 'recipient',
  raw_value text not null,
  raw_value_key text not null,
  normalized_value text not null,
  canonical_value text not null,
  match_method text not null default 'rule' check (match_method in ('rule', 'exact_raw', 'exact_normalized', 'fuzzy', 'manual', 'empty')),
  confidence numeric(5,4) not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (entity_type, raw_value_key)
);

create index if not exists idx_insaights_recipient_aliases_norm on insaights_recipient_aliases(entity_type, normalized_value);
create index if not exists idx_insaights_recipient_aliases_canonical on insaights_recipient_aliases(entity_type, canonical_value);

create table if not exists insaights_config_provider_keys (
  id uuid primary key default gen_random_uuid(),
  provider_name text not null unique check (provider_name in ('mistral')),
  is_enabled boolean not null default false,
  key_value text,
  updated_by uuid,
  updated_at timestamptz not null default now()
);

insert into insaights_config_provider_keys (provider_name, is_enabled)
values ('mistral', false)
on conflict (provider_name) do nothing;

create table if not exists insaights_config_extraction_fields (
  id uuid primary key default gen_random_uuid(),
  entity_name text not null default 'invoice',
  scope text not null check (scope in ('header', 'line_item')),
  field_name text not null,
  description text not null default '',
  data_type text not null default 'string' check (data_type in ('string', 'number', 'integer', 'date', 'boolean')),
  is_required boolean not null default false,
  is_enabled boolean not null default true,
  sort_order integer not null default 0,
  updated_by uuid,
  updated_at timestamptz not null default now(),
  unique (entity_name, scope, field_name)
);

insert into insaights_config_extraction_fields (entity_name, scope, field_name, description, data_type, is_required, is_enabled, sort_order)
values
('invoice', 'header', 'supplier_name', 'Name des Lieferanten', 'string', true, true, 10),
('invoice', 'header', 'invoice_number', 'Eindeutige Rechnungsnummer', 'string', true, true, 20),
('invoice', 'header', 'invoice_date', 'Rechnungsdatum', 'date', true, true, 30),
('invoice', 'header', 'due_date', 'Faelligkeitsdatum', 'date', false, true, 40),
('invoice', 'header', 'currency', 'Waehrung als ISO Code', 'string', false, true, 50),
('invoice', 'header', 'gross_amount', 'Bruttobetrag der Rechnung', 'number', true, true, 60),
('invoice', 'header', 'net_amount', 'Nettobetrag der Rechnung', 'number', false, true, 70),
('invoice', 'header', 'tax_amount', 'Steuerbetrag', 'number', false, true, 80),
('invoice', 'line_item', 'line_no', 'Positionsnummer', 'integer', false, true, 10),
('invoice', 'line_item', 'description', 'Positionsbeschreibung', 'string', false, true, 20),
('invoice', 'line_item', 'quantity', 'Menge', 'number', false, true, 30),
('invoice', 'line_item', 'unit_price', 'Einzelpreis', 'number', false, true, 40),
('invoice', 'line_item', 'line_amount', 'Gesamtbetrag der Position', 'number', false, true, 50),
('invoice', 'line_item', 'tax_rate', 'Steuersatz der Position in Prozent', 'number', false, true, 60)
on conflict (entity_name, scope, field_name) do nothing;

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

create table if not exists insaights_invoices (
  id uuid primary key default gen_random_uuid(),
  document_id uuid references insaights_documents(id) on delete set null,
  source_system text not null default 'minio',
  supplier_name text,
  invoice_number text,
  invoice_date date,
  due_date date,
  currency text not null default 'EUR',
  gross_amount numeric(14,2),
  net_amount numeric(14,2),
  tax_amount numeric(14,2),
  status text not null default 'MAPPED',
  confidence_score numeric(5,2) not null default 0,
  extraction_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_insaights_invoices_document on insaights_invoices(document_id);
create index if not exists idx_insaights_invoices_status on insaights_invoices(status);
create index if not exists idx_insaights_invoices_created on insaights_invoices(created_at desc);

create table if not exists insaights_invoice_lines (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references insaights_invoices(id) on delete cascade,
  line_no integer not null,
  description text,
  quantity numeric(12,3),
  unit_price numeric(14,4),
  line_amount numeric(14,2),
  tax_rate numeric(6,3),
  created_at timestamptz not null default now()
);

create index if not exists idx_insaights_invoice_lines_invoice on insaights_invoice_lines(invoice_id);

create table if not exists insaights_invoice_actions (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references insaights_invoices(id) on delete cascade,
  action_type text not null check (action_type in ('approve', 'reject', 'hold', 'request_clarification')),
  comment text,
  from_status text,
  to_status text not null,
  actor_user_id uuid,
  actor_username text,
  created_at timestamptz not null default now()
);

create index if not exists idx_insaights_invoice_actions_invoice on insaights_invoice_actions(invoice_id, created_at desc);

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'insaights_invoice_actions_action_type_check'
      and conrelid = 'insaights_invoice_actions'::regclass
  ) then
    alter table insaights_invoice_actions drop constraint insaights_invoice_actions_action_type_check;
  end if;
exception when undefined_table then
  null;
end $$;

alter table if exists insaights_invoice_actions
  add constraint insaights_invoice_actions_action_type_check
  check (action_type in ('approve', 'reject', 'hold', 'request_clarification'));

create table if not exists insaights_invoice_cases (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references insaights_invoices(id) on delete cascade,
  title text not null,
  description text,
  status text not null default 'OPEN' check (status in ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED')),
  created_by_user_id uuid,
  created_by_username text,
  resolved_note text,
  resolved_by_user_id uuid,
  resolved_by_username text,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_insaights_invoice_cases_invoice on insaights_invoice_cases(invoice_id, created_at desc);
create index if not exists idx_insaights_invoice_cases_status on insaights_invoice_cases(status, updated_at desc);

create or replace function insaights_reset_invoice_pipeline()
returns jsonb
language plpgsql
security definer
as $$
declare
  v_invoice_actions integer := 0;
  v_invoice_cases integer := 0;
  v_invoice_lines integer := 0;
  v_invoices integer := 0;
  v_documents integer := 0;
begin
  select count(*) into v_invoice_actions from insaights_invoice_actions;
  select count(*) into v_invoice_cases from insaights_invoice_cases;
  select count(*) into v_invoice_lines from insaights_invoice_lines;
  select count(*) into v_invoices from insaights_invoices;
  select count(*) into v_documents from insaights_documents;

  delete from insaights_invoice_actions;
  delete from insaights_invoice_cases;
  delete from insaights_invoice_lines;
  delete from insaights_invoices;
  delete from insaights_documents;

  return jsonb_build_object(
    'invoice_actions_deleted', v_invoice_actions,
    'invoice_cases_deleted', v_invoice_cases,
    'invoice_lines_deleted', v_invoice_lines,
    'invoices_deleted', v_invoices,
    'documents_deleted', v_documents,
    'mode', 'rpc_function'
  );
end;
$$;
