import { loadObjectSet } from "@/ontology/objectSet";
import { handle } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = await req.json();
  return handle(() =>
    loadObjectSet(body.objectSet, {
      pageSize: body.pageSize,
      offset: body.offset,
      orderBy: body.orderBy,
    })
  );
}
