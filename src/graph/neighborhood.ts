// Neighborhood extraction for the graph explorer: BFS over link_instance
// from a seed object out to N hops, capped. This is the "search-around"
// gesture materialized as a subgraph.

import { getPool } from "@/db/client";
import { getOntology, requireType } from "@/ontology/metadata";
import { ApiError } from "@/ontology/types";

export interface GraphNode {
  id: string; // obj uuid
  type: string;
  pk: string;
  title: string | null;
  seed?: boolean;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  label: string;
  fromEdit: boolean;
}

const MAX_NODES = 220;

export async function getNeighborhood(
  typeApiName: string,
  pk: string,
  hops = 1
): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }> {
  const meta = await getOntology();
  const type = requireType(meta, typeApiName);
  const pool = getPool();
  const linkLabel = new Map(meta.links.map((l) => [l.id, l.displayName]));
  const typeById = new Map(meta.types.map((t) => [t.id, t]));

  const seedRes = await pool.query(
    `select id from obj where object_type_id = $1 and pk_value = $2 and not deleted`,
    [type.id, pk]
  );
  if (!seedRes.rows.length) throw new ApiError(404, `${typeApiName} ${pk} not found`);
  const seedId: string = seedRes.rows[0].id;

  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, GraphEdge>();
  let frontier = [seedId];
  const visited = new Set<string>([seedId]);

  async function addNode(id: string, propsRow: { object_type_id: string; pk_value: string; props: Record<string, unknown> }) {
    if (nodes.has(id)) return;
    const t = typeById.get(propsRow.object_type_id);
    nodes.set(id, {
      id,
      type: t?.apiName ?? "?",
      pk: propsRow.pk_value,
      title: (propsRow.props?.[t?.titleProperty ?? ""] as string) ?? propsRow.pk_value,
      seed: id === seedId,
    });
  }

  // Seed node details.
  const seedDetail = await pool.query(
    `select object_type_id, pk_value, props from obj where id = $1`,
    [seedId]
  );
  await addNode(seedId, seedDetail.rows[0]);

  for (let h = 0; h < hops && frontier.length && nodes.size < MAX_NODES; h++) {
    const rows = (
      await pool.query(
        `select li.id, li.link_type_id, li.obj_a, li.obj_b, li.from_edit,
                a.object_type_id ota, a.pk_value pka, a.props pa,
                b.object_type_id otb, b.pk_value pkb, b.props pb
         from link_instance li
         join obj a on a.id = li.obj_a and not a.deleted
         join obj b on b.id = li.obj_b and not b.deleted
         where li.obj_a = any($1) or li.obj_b = any($1)`,
        [frontier]
      )
    ).rows;

    const next: string[] = [];
    for (const r of rows) {
      if (nodes.size >= MAX_NODES) break;
      await addNode(r.obj_a, { object_type_id: r.ota, pk_value: r.pka, props: r.pa });
      await addNode(r.obj_b, { object_type_id: r.otb, pk_value: r.pkb, props: r.pb });
      edges.set(r.id, {
        id: r.id,
        source: r.obj_a,
        target: r.obj_b,
        label: linkLabel.get(r.link_type_id) ?? "",
        fromEdit: r.from_edit,
      });
      for (const other of [r.obj_a, r.obj_b]) {
        if (!visited.has(other)) {
          visited.add(other);
          next.push(other);
        }
      }
    }
    frontier = next;
  }

  return { nodes: [...nodes.values()], edges: [...edges.values()] };
}
