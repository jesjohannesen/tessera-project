import { runAutomations } from "@/ai/automations";
import { handle } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function POST() {
  return handle(async () => ({ results: await runAutomations("web") }));
}
