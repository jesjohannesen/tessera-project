import { getNeighborhood } from "@/graph/neighborhood";
import { handle } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const type = url.searchParams.get("type");
  const pk = url.searchParams.get("pk");
  const hops = Number(url.searchParams.get("hops") ?? 1);
  return handle(async () => {
    if (!type || !pk) throw new Error("type and pk are required");
    return await getNeighborhood(type, pk, Math.min(Math.max(hops, 1), 2));
  });
}
