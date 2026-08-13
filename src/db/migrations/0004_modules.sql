-- Tessera Phase 4: the product builder. Modules are JSON documents (widgets +
-- variables) with a draft/published split and immutable version history —
-- apps as data, like everything else. Dossiers are analyst-authored documents
-- with live entity mentions.

create table module (
  id uuid primary key default gen_random_uuid(),
  api_name text unique not null,
  display_name text not null,
  description text,
  draft jsonb not null default '{"variables": [], "widgets": []}',
  published jsonb,
  published_version int not null default 0,
  created_by text not null default 'local',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table module_version (
  id bigint generated always as identity primary key,
  module_id uuid not null references module(id) on delete cascade,
  version int not null,
  definition jsonb not null,
  published_by text not null,
  published_at timestamptz not null default now(),
  unique (module_id, version)
);

create table dossier (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null default '',
  created_by text not null default 'local',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
