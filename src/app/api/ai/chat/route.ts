import { runAgent } from "@/ai/agent";
import { handle } from "@/lib/api";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request) {
  const body = await req.json();
  return handle(() =>
    runAgent(body.apiMessages ?? [], String(body.message ?? ""), { actor: "agent:web" })
  );
}
