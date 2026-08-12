import { aggregateObjectSet } from "@/ontology/objectSet";
import { handle } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = await req.json();
  return handle(() => aggregateObjectSet(body.objectSet, body.aggregation));
}
