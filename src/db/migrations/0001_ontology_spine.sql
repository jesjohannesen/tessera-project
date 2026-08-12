-- Tessera Phase 0: ontology spine
-- Two planes: metadata (what types exist) and instances (the objects themselves).

-- ============ METADATA PLANE ============

create table object_type (
  id uuid primary key default gen_random_uuid(),
  api_name text unique not null,
  display_name text not null,
  description text,
  kind text not null default 'entity' check (kind in ('entity', 'event', 'document')),
  pk_property text not null,
  title_property text not null,
  status text not null default 'active' check (status in ('experimental', 'active', 'deprecated')),
  version int not null default 1,
  created_at timestamptz not null default now()
);

create table property_def (
  id uuid primary key default gen_random_uuid(),
  object_type_id uuid not null references object_type(id) on delete cascade,
  api_name text not null,
  display_name text not null,
  description text,
  type text not null check (type in ('string', 'integer', 'double', 'boolean', 'date', 'timestamp', 'geopoint', 'string_array', 'json')),
  searchable boolean not null default false,
  required boolean not null default false,
  position int not null default 0,
  unique (object_type_id, api_name)
);

-- A link type connects two object types; each direction has its own api name.
create table link_type (
  id uuid primary key default gen_random_uuid(),
  api_name_a_to_b text not null unique,
  api_name_b_to_a text not null unique,
  display_name text not null,
  object_type_a uuid not null references object_type(id) on delete cascade,
  object_type_b uuid not null references object_type(id) on delete cascade,
  cardinality text not null check (cardinality in ('one_to_one', 'one_to_many', 'many_to_many')),
  created_at timestamptz not null default now()
);

-- Actions: the only write path. Parameters, criteria, and rules are declarative JSON.
create table action_type (
  id uuid primary key default gen_random_uuid(),
  api_name text unique not null,
  display_name text not null,
  description text,
  parameters jsonb not null default '[]',
  submission_criteria jsonb not null default '[]',
  rules jsonb not null default '[]',
  status text not null default 'active' check (status in ('experimental', 'active', 'deprecated')),
  version int not null default 1,
  created_at timestamptz not null default now()
);

-- ============ INSTANCE PLANE ============

-- source_props: written only by ingest/sync (Phase 1+). edit_props: written only by actions.
-- props is the flattened read view: edits win per-property (the overlay).
create table obj (
  id uuid primary key default gen_random_uuid(),
  object_type_id uuid not null references object_type(id) on delete cascade,
  pk_value text not null,
  source_props jsonb not null default '{}',
  edit_props jsonb not null default '{}',
  props jsonb generated always as (source_props || edit_props) stored,
  deleted boolean not null default false,
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (object_type_id, pk_value)
);

create index obj_props_gin on obj using gin (props jsonb_path_ops);
create index obj_type_live_idx on obj (object_type_id) where not deleted;

create table link_instance (
  id uuid primary key default gen_random_uuid(),
  link_type_id uuid not null references link_type(id) on delete cascade,
  obj_a uuid not null references obj(id) on delete cascade,
  obj_b uuid not null references obj(id) on delete cascade,
  from_edit boolean not null default false,
  created_at timestamptz not null default now(),
  unique (link_type_id, obj_a, obj_b)
);

create index link_a_idx on link_instance (obj_a, link_type_id);
create index link_b_idx on link_instance (obj_b, link_type_id);

-- ============ WRITE HISTORY ============

create table action_instance (
  id uuid primary key default gen_random_uuid(),
  action_type_id uuid not null references action_type(id),
  actor text not null default 'local',
  params jsonb not null,
  status text not null check (status in ('applied', 'rejected', 'failed')),
  error text,
  created_at timestamptz not null default now()
);

-- Append-only record of every edit an action produced.
create table edit_log (
  id bigint generated always as identity primary key,
  action_instance_id uuid references action_instance(id),
  obj_id uuid,
  link_id uuid,
  edit_type text not null check (edit_type in ('create_object', 'modify_object', 'delete_object', 'create_link', 'delete_link')),
  patch jsonb,
  created_at timestamptz not null default now()
);

-- Append-only, category-typed audit (the lean audit.3).
create table audit_log (
  id bigint generated always as identity primary key,
  ts timestamptz not null default now(),
  actor text not null,
  category text not null,
  detail jsonb not null default '{}'
);
