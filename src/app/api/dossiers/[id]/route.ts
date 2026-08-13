import { getDossier, saveDossier } from "@/modules/store";
import { handle } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return handle(() => getDossier(id));
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();
  return handle(async () => {
    await saveDossier(id, { title: body.title, body: body.body }, "web");
    return { ok: true };
  });
}
