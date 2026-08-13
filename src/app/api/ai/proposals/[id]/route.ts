import { decideProposal } from "@/ai/tools";
import { handle } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();
  return handle(async () => {
    if (body.decision !== "approved" && body.decision !== "rejected")
      throw new Error("decision must be 'approved' or 'rejected'");
    return await decideProposal(id, body.decision, "web");
  });
}
