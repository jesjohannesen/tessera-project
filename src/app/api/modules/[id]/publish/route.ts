import { publishModule } from "@/modules/store";
import { handle } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return handle(() => publishModule(id, "web"));
}
