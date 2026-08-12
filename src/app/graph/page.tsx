import { getPool } from "@/db/client";
import { getOntology } from "@/ontology/metadata";
import { getNeighborhood } from "@/graph/neighborhood";
import { GraphView } from "./GraphView";

export const dynamic = "force-dynamic";

export default async function GraphPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const meta = await getOntology();
  const pool = getPool();

  let seedType = typeof sp.type === "string" ? sp.type : null;
  let seedPk = typeof sp.pk === "string" ? sp.pk : null;

  // Default seed: the most-linked object (the richest starting point).
  if (!seedType || !seedPk) {
    const res = await pool.query(`
      select ot.api_name as type, o.pk_value as pk, count(li.id) as deg
      from obj o
      join object_type ot on ot.id = o.object_type_id
      join link_instance li on li.obj_a = o.id or li.obj_b = o.id
      where not o.deleted
      group by ot.api_name, o.pk_value
      order by deg desc
      limit 1`);
    if (res.rows.length) {
      seedType = res.rows[0].type;
      seedPk = res.rows[0].pk;
    }
  }

  const initial = seedType && seedPk ? await getNeighborhood(seedType, seedPk, 2) : { nodes: [], edges: [] };

  return (
    <main>
      <h1>Graph Explorer</h1>
      <p className="sub">
        Link analysis over the ontology. Click any node to search around it — its neighbors expand
        into the graph. Drag to rearrange.
      </p>
      {initial.nodes.length ? (
        <GraphView initial={initial} seedType={seedType!} seedPk={seedPk!} />
      ) : (
        <p className="empty">No linked objects to graph yet. Ingest data or seed the demo ontology.</p>
      )}
      <p className="section-note" style={{ marginTop: "1rem" }}>
        Object types:{" "}
        {meta.types.map((t) => t.displayName).join(" · ")}
      </p>
    </main>
  );
}
