import { runMatcher } from "@/resolve/matcher";
import { handle } from "@/lib/api";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  return handle(async () => ({
    results: await runMatcher(body.type || undefined, "web"),
  }));
}
