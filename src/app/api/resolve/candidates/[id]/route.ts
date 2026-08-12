import { decideCandidate } from "@/resolve/matcher";
import { handle } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();
  return handle(async () => {
    if (body.decision !== "accepted" && body.decision !== "rejected")
      throw new Error("decision must be 'accepted' or 'rejected'");
    return await decideCandidate(Number(id), body.decision, "web");
  });
}
