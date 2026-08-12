import { loadObjectSet } from "@/ontology/objectSet";
import { handle } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ type: string }> }
) {
  const { type } = await params;
  const url = new URL(req.url);
  const orderProp = url.searchParams.get("orderBy");
  return handle(() =>
    loadObjectSet(
      { type },
      {
        pageSize: Number(url.searchParams.get("pageSize") ?? 50),
        offset: Number(url.searchParams.get("offset") ?? 0),
        orderBy: orderProp
          ? {
              property: orderProp,
              direction: url.searchParams.get("direction") === "desc" ? "desc" : "asc",
            }
          : undefined,
      }
    )
  );
}
