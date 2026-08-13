import Link from "next/link";
import { getOntology } from "@/ontology/metadata";
import { getModule } from "@/modules/store";
import { ModuleRuntime } from "../components/ModuleRuntime";

export const dynamic = "force-dynamic";

export default async function ModuleViewer({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [module, meta] = await Promise.all([getModule(id), getOntology()]);
  const def = module.published ?? module.draft;
  const isDraft = !module.published;

  return (
    <main>
      <p className="mono">
        <Link href="/modules">Modules</Link>
      </p>
      <h1>{module.displayName}</h1>
      <p className="sub">
        {isDraft ? "Draft (never published)" : `Published v${module.publishedVersion}`} ·{" "}
        <Link className="rowlink" href={`/modules/${module.id}/edit`}>
          open in builder
        </Link>
      </p>
      <ModuleRuntime def={def} meta={meta} />
    </main>
  );
}
