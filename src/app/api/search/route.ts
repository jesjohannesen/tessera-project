import { searchObjects } from "@/search/search";
import { handle } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = url.searchParams.get("q") ?? "";
  return handle(async () => ({ groups: await searchObjects(q, 5) }));
}
