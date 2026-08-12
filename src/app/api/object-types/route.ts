import { getOntology } from "@/ontology/metadata";
import { handle } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET() {
  return handle(() => getOntology());
}
