import { runBuild, runSyncs } from "@/data/runner";
import { handle } from "@/lib/api";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: Request) {
  const body = await req.json();
  return handle(async () => {
    if (body.kind === "sync") {
      return { results: await runSyncs(body.target || undefined) };
    }
    if (body.kind === "build") {
      return await runBuild("web");
    }
    throw new Error("kind must be 'sync' or 'build'");
  });
}
