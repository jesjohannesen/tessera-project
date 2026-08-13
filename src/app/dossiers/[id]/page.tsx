import { getDossier } from "@/modules/store";
import { DossierEditor } from "./DossierEditor";

export const dynamic = "force-dynamic";

export default async function DossierPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const dossier = await getDossier(id);
  return <DossierEditor dossier={dossier} />;
}
