import { createModule, listModules } from "@/modules/store";
import { handle } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET() {
  return handle(() => listModules());
}

export async function POST(req: Request) {
  const body = await req.json();
  return handle(() =>
    createModule(body.apiName, body.displayName ?? body.apiName, body.description ?? null, "web")
  );
}
