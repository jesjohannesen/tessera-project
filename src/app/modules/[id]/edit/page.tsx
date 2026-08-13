import { getOntology } from "@/ontology/metadata";
import { getModule } from "@/modules/store";
import { ModuleBuilder } from "./ModuleBuilder";

export const dynamic = "force-dynamic";

export default async function ModuleEditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [module, meta] = await Promise.all([getModule(id), getOntology()]);
  return <ModuleBuilder module={module} meta={meta} />;
}
