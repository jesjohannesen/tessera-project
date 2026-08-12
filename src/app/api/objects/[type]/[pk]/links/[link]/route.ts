import { listLinked } from "@/ontology/objectSet";
import { handle } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ type: string; pk: string; link: string }> }
) {
  const { type, pk, link } = await params;
  return handle(() => listLinked(type, decodeURIComponent(pk), link));
}
