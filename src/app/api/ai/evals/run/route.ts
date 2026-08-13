import { runEvals } from "@/ai/evals";
import { handle } from "@/lib/api";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST() {
  return handle(() => runEvals());
}
