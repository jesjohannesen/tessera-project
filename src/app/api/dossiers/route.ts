import { createDossier, listDossiers } from "@/modules/store";
import { handle } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET() {
  return handle(() => listDossiers());
}

export async function POST(req: Request) {
  const body = await req.json();
  return handle(() => createDossier(body.title ?? "", "web"));
}
