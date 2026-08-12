-- Tessera Phase 1: the data layer.
-- source → sync → dataset (transaction log) → transform → dataset | ontology.

create table source (
  id uuid primary key default gen_random_uuid(),
  api_name text unique not null,
  display_name text not null,
  type text not null check (type in ('rss', 'gdelt', 'opensanctions')),
  config jsonb not null default '{}',
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

create table dataset (
  id uuid primary key default gen_random_uuid(),
  api_name text unique not null,
  display_name text not null,
  description text,
  created_at timestamptz not null default now()
);

-- Every write to a dataset is a transaction; reads see only committed ones.
create table ds_txn (
  id bigint generated always as identity primary key,
  dataset_id uuid not null references dataset(id) on delete cascade,
  type text not null check (type in ('snapshot', 'append')),
  status text not null default 'open' check (status in ('open', 'committed', 'aborted')),
  meta jsonb not null default '{}',
  started_at timestamptz not null default now(),
  committed_at timestamptz
);
create index ds_txn_dataset_idx on ds_txn (dataset_id, id);

create table ds_record (
  id bigint generated always as identity primary key,
  dataset_id uuid not null references dataset(id) on delete cascade,
  txn_id bigint not null references ds_txn(id) on delete cascade,
  pk text not null,
  payload jsonb not null
);
create index ds_record_dataset_txn_idx on ds_record (dataset_id, txn_id);
create index ds_record_dataset_pk_idx on ds_record (dataset_id, pk);

create table sync (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references source(id) on delete cascade,
  dataset_id uuid not null references dataset(id) on delete cascade,
  mode text not null default 'incremental' check (mode in ('full', 'incremental')),
  cursor jsonb not null default '{}',
  schedule_minutes int not null default 60,
  last_run_at timestamptz,
  last_status text,
  last_error text,
  unique (source_id, dataset_id)
);

-- Declared transforms: inputs/outputs as data, so lineage is computed, never drawn.
create table transform (
  id uuid primary key default gen_random_uuid(),
  api_name text unique not null,
  display_name text not null,
  description text,
  inputs text[] not null,
  output_kind text not null check (output_kind in ('dataset', 'ontology')),
  output_dataset text,
  entrypoint text not null,
  semantic_version int not null default 1,
  created_at timestamptz not null default now()
);

create table build (
  id bigint generated always as identity primary key,
  trigger text not null,
  status text not null default 'running' check (status in ('running', 'succeeded', 'failed')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  error text
);

create table job (
  id bigint generated always as identity primary key,
  build_id bigint not null references build(id) on delete cascade,
  transform_id uuid not null references transform(id) on delete cascade,
  status text not null default 'running' check (status in ('running', 'succeeded', 'failed', 'skipped')),
  read_from jsonb not null default '{}',
  wrote_txn_id bigint,
  rows_out int not null default 0,
  objects_upserted int not null default 0,
  links_upserted int not null default 0,
  error text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);
create index job_transform_idx on job (transform_id, id desc);
