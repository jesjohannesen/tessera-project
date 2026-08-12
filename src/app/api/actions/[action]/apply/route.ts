import { applyAction } from "@/ontology/actions";
import { handle } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ action: string }> }
) {
  const { action } = await params;
  const body = await req.json();
  return handle(() =>
    applyAction(action, body.parameters ?? {}, {
      actor: "web",
      validateOnly: body.validateOnly === true,
    })
  );
}
