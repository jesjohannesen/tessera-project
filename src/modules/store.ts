// Persistence for modules (draft/publish/version history) and dossiers.

import { getPool } from "@/db/client";
import { ApiError } from "@/ontology/types";
import { ModuleDef, ModuleRecord, emptyModule, validateModuleDef } from "./types";

function rowToModule(r: Record<string, unknown>): ModuleRecord {
  return {
    id: r.id as string,
    apiName: r.api_name as string,
    displayName: r.display_name as string,
    description: (r.description as string) ?? null,
    draft: r.draft as ModuleDef,
    published: (r.published as ModuleDef) ?? null,
    publishedVersion: Number(r.published_version),
    updatedAt: String(r.updated_at),
  };
}

export async function listModules(): Promise<ModuleRecord[]> {
  const res = await getPool().query(`select * from module order by display_name`);
  return res.rows.map(rowToModule);
}

export async function getModule(id: string): Promise<ModuleRecord> {
  const res = await getPool().query(`select * from module where id = $1`, [id]);
  if (!res.rows.length) throw new ApiError(404, `Unknown module ${id}`);
  return rowToModule(res.rows[0]);
}

export async function createModule(
  apiName: string,
  displayName: string,
  description: string | null,
  actor: string
): Promise<ModuleRecord> {
  if (!/^[a-z][a-z0-9_]*$/.test(apiName))
    throw new ApiError(400, "api_name must be snake_case (a-z, 0-9, _)");
  const res = await getPool().query(
    `insert into module (api_name, display_name, description, draft, created_by)
     values ($1, $2, $3, $4, $5)
     on conflict (api_name) do nothing returning *`,
    [apiName, displayName, description, JSON.stringify(emptyModule()), actor]
  );
  if (!res.rows.length) throw new ApiError(409, `Module ${apiName} already exists`);
  await getPool().query(
    `insert into audit_log (actor, category, detail) values ($1, 'moduleCreated', $2)`,
    [actor, JSON.stringify({ apiName })]
  );
  return rowToModule(res.rows[0]);
}

export async function saveDraft(id: string, def: ModuleDef, actor: string): Promise<void> {
  const problem = validateModuleDef(def);
  if (problem) throw new ApiError(400, `Invalid module definition: ${problem}`);
  const res = await getPool().query(
    `update module set draft = $2, updated_at = now() where id = $1 returning api_name`,
    [id, JSON.stringify(def)]
  );
  if (!res.rows.length) throw new ApiError(404, `Unknown module ${id}`);
  void actor;
}

export async function publishModule(id: string, actor: string): Promise<{ version: number }> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("begin");
    const res = await client.query(`select * from module where id = $1 for update`, [id]);
    if (!res.rows.length) throw new ApiError(404, `Unknown module ${id}`);
    const m = res.rows[0];
    const problem = validateModuleDef(m.draft);
    if (problem) throw new ApiError(400, `Cannot publish: ${problem}`);
    const version = Number(m.published_version) + 1;
    await client.query(
      `update module set published = draft, published_version = $2, updated_at = now() where id = $1`,
      [id, version]
    );
    await client.query(
      `insert into module_version (module_id, version, definition, published_by) values ($1, $2, $3, $4)`,
      [id, version, JSON.stringify(m.draft), actor]
    );
    await client.query(
      `insert into audit_log (actor, category, detail) values ($1, 'modulePublished', $2)`,
      [actor, JSON.stringify({ moduleId: id, apiName: m.api_name, version })]
    );
    await client.query("commit");
    return { version };
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }
}

// ---- Dossiers ----

export interface DossierRecord {
  id: string;
  title: string;
  body: string;
  updatedAt: string;
}

export async function listDossiers(): Promise<DossierRecord[]> {
  const res = await getPool().query(`select * from dossier order by updated_at desc`);
  return res.rows.map((r) => ({ id: r.id, title: r.title, body: r.body, updatedAt: String(r.updated_at) }));
}

export async function getDossier(id: string): Promise<DossierRecord> {
  const res = await getPool().query(`select * from dossier where id = $1`, [id]);
  if (!res.rows.length) throw new ApiError(404, `Unknown dossier ${id}`);
  const r = res.rows[0];
  return { id: r.id, title: r.title, body: r.body, updatedAt: String(r.updated_at) };
}

export async function createDossier(title: string, actor: string): Promise<DossierRecord> {
  const res = await getPool().query(
    `insert into dossier (title, created_by) values ($1, $2) returning *`,
    [title || "Untitled dossier", actor]
  );
  const r = res.rows[0];
  await getPool().query(
    `insert into audit_log (actor, category, detail) values ($1, 'dossierCreated', $2)`,
    [actor, JSON.stringify({ dossierId: r.id, title: r.title })]
  );
  return { id: r.id, title: r.title, body: r.body, updatedAt: String(r.updated_at) };
}

export async function saveDossier(
  id: string,
  patch: { title?: string; body?: string },
  actor: string
): Promise<void> {
  const res = await getPool().query(
    `update dossier set title = coalesce($2, title), body = coalesce($3, body), updated_at = now()
     where id = $1 returning id`,
    [id, patch.title ?? null, patch.body ?? null]
  );
  if (!res.rows.length) throw new ApiError(404, `Unknown dossier ${id}`);
  void actor;
}

/** Entity mentions in dossier markdown: @[type:pk|Label] */
export function extractMentions(body: string): { type: string; pk: string; label: string }[] {
  const out: { type: string; pk: string; label: string }[] = [];
  const re = /@\[([a-z_]+):([^\]|]+)\|([^\]]+)\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) out.push({ type: m[1], pk: m[2], label: m[3] });
  return out;
}
