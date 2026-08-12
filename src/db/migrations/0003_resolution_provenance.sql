-- Tessera Phase 2: per-value provenance (the "card stack") and
-- non-destructive entity resolution with first-class unresolve.

create extension if not exists pg_trgm;

-- Append-only history of every property value: who wrote it, from where, when.
create table prop_provenance (
  id bigint generated always as identity primary key,
  obj_id uuid not null references obj(id) on delete cascade,
  property text not null,
  value jsonb,
  origin text not null check (origin in ('source', 'edit')),
  writer text not null,        -- 'seed' | 'transform:<api>' | 'action:<api>' | 'backfill:0003'
  source_ref text,             -- build/job id, action_instance id
  recorded_at timestamptz not null default now()
);
create index prop_provenance_obj_idx on prop_provenance (obj_id, property, id desc);

-- Backfill: existing props become one provenance card each, so history
-- starts populated for everything already ingested.
insert into prop_provenance (obj_id, property, value, origin, writer)
select o.id, kv.key, kv.value, 'source', 'backfill:0003'
from obj o, jsonb_each(o.source_props) kv;

insert into prop_provenance (obj_id, property, value, origin, writer)
select o.id, kv.key, kv.value, 'edit', 'backfill:0003'
from obj o, jsonb_each(o.edit_props) kv;

-- Resolution bags: N objects presented as one canonical entity.
-- Dissolving (unresolve) keeps the row for history; members stay recorded.
create table resolution (
  id uuid primary key default gen_random_uuid(),
  object_type_id uuid not null references object_type(id) on delete cascade,
  canonical_key text unique not null,
  status text not null default 'active' check (status in ('active', 'dissolved')),
  method text not null,
  confidence double precision,
  created_by text not null,
  created_at timestamptz not null default now(),
  dissolved_at timestamptz,
  dissolved_by text
);

create table resolution_member (
  resolution_id uuid not null references resolution(id) on delete cascade,
  obj_id uuid not null references obj(id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (resolution_id, obj_id)
);
create index resolution_member_obj_idx on resolution_member (obj_id);

-- The review queue: scored pairs awaiting a decision.
create table resolution_candidate (
  id bigint generated always as identity primary key,
  object_type_id uuid not null references object_type(id) on delete cascade,
  obj_a uuid not null references obj(id) on delete cascade,
  obj_b uuid not null references obj(id) on delete cascade,
  score double precision not null,
  features jsonb not null default '{}',
  status text not null default 'pending' check (status in ('pending', 'accepted', 'rejected', 'auto')),
  decided_by text,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  unique (obj_a, obj_b)
);
create index resolution_candidate_status_idx on resolution_candidate (status, score desc);

-- Fuzzy-name blocking support.
create index obj_name_trgm on obj using gin ((lower(props->>'name')) gin_trgm_ops);
