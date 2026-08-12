import { getObject } from "@/ontology/objectSet";
import { handle } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ type: string; pk: string }> }
) {
  const { type, pk } = await params;
  return handle(() => getObject(type, decodeURIComponent(pk)));
}
