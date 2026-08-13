-- Tessera Phase 5: the AI layer. Proposals are the propose-then-promote gate:
-- the model can only stage writes; a human approves or rejects, and approval
-- routes through the ordinary actions engine.

create table proposal (
  id uuid primary key default gen_random_uuid(),
  action_api text not null,
  params jsonb not null,
  rationale text,
  proposed_by text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'failed')),
  decided_by text,
  decided_at timestamptz,
  action_instance_id uuid,
  error text,
  created_at timestamptz not null default now()
);
create index proposal_status_idx on proposal (status, created_at desc);

-- Standing automations: object-set condition -> threshold -> alert.
create table automation (
  id uuid primary key default gen_random_uuid(),
  api_name text unique not null,
  display_name text not null,
  object_type text not null,
  filter jsonb,
  comparator text not null check (comparator in ('gt', 'gte', 'lt', 'lte', 'eq')),
  threshold int not null,
  enabled boolean not null default true,
  last_run_at timestamptz,
  last_value int,
  last_triggered_at timestamptz
);

create table alert (
  id bigint generated always as identity primary key,
  automation_id uuid not null references automation(id) on delete cascade,
  message text not null,
  value int not null,
  created_at timestamptz not null default now()
);

-- Minimal eval harness over the agent.
create table eval_case (
  id uuid primary key default gen_random_uuid(),
  name text unique not null,
  prompt text not null,
  expect jsonb not null,
  created_at timestamptz not null default now()
);

create table eval_run (
  id bigint generated always as identity primary key,
  model text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  passed int not null default 0,
  failed int not null default 0
);

create table eval_result (
  id bigint generated always as identity primary key,
  run_id bigint not null references eval_run(id) on delete cascade,
  case_id uuid not null references eval_case(id) on delete cascade,
  passed boolean not null,
  output text,
  detail jsonb not null default '{}'
);
