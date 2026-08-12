import { unresolve } from "@/resolve/resolutions";
import { handle } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ key: string }> }
) {
  const { key } = await params;
  return handle(async () => {
    await unresolve(key, "web");
    return { ok: true };
  });
}
