// The analyst agent: a bounded manual tool-use loop over the Claude API.
// Reads happen through the governed ontology tools; writes only ever stage
// proposals. The full API message array is returned to the (stateless) client
// so conversation context — including tool results — survives across turns.

import Anthropic from "@anthropic-ai/sdk";
import { getOntology } from "@/ontology/metadata";
import { buildTools, executeTool, ontologyDigest } from "./tools";

export const AGENT_MODEL = process.env.TESSERA_MODEL ?? "claude-opus-5";
const MAX_ITERATIONS = 8;

export interface DisplayItem {
  kind: "text" | "tool";
  text?: string;
  tool?: string;
  input?: string;
  result?: string;
}

export interface AgentTurn {
  display: DisplayItem[];
  apiMessages: Anthropic.MessageParam[];
  stopReason: string | null;
  error?: string;
}

function systemPrompt(digest: string): string {
  return `You are Tessera's analyst assistant — an OSINT analysis copilot working over an ontology of entities, events, and documents built from open sources (sanctions lists, news feeds).

${digest}

How to work:
- Answer questions by querying the ontology with your tools; cite object primary keys (pk) so the user can open them.
- All property filters use only searchable properties. Link traversals use the traversal api names listed above.
- Writes: you can only stage proposals via propose_action; every proposal goes to human review and is never applied automatically. Never claim a change has been made — say it is staged for review.
- Provenance matters: when data conflicts, say which source said what rather than silently picking one.
- Keep responses focused, brief, and concise. Lead with the answer; cite pks inline.`;
}

export async function runAgent(
  priorMessages: Anthropic.MessageParam[],
  userMessage: string,
  opts: { actor?: string } = {}
): Promise<AgentTurn> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return {
      display: [],
      apiMessages: priorMessages,
      stopReason: null,
      error:
        "ANTHROPIC_API_KEY is not set. Add it to tessera-project/.env and restart the dev server to enable the analyst agent.",
    };
  }

  const client = new Anthropic();
  const meta = await getOntology();
  const tools = buildTools(meta);
  const system = systemPrompt(ontologyDigest(meta));
  const actor = opts.actor ?? "agent";

  const messages: Anthropic.MessageParam[] = [
    ...priorMessages,
    { role: "user", content: userMessage },
  ];
  const display: DisplayItem[] = [];
  let stopReason: string | null = null;

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const response = await client.beta.messages.create({
      model: AGENT_MODEL,
      max_tokens: 8000,
      system,
      tools: tools as Anthropic.Beta.BetaTool[],
      messages: messages as Anthropic.Beta.BetaMessageParam[],
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    } as never) as Anthropic.Beta.BetaMessage;

    stopReason = response.stop_reason;

    if (response.stop_reason === "refusal") {
      display.push({
        kind: "text",
        text: "The model declined this request (safety classifier). Rephrase and try again.",
      });
      messages.push({ role: "assistant", content: response.content as never });
      break;
    }

    messages.push({ role: "assistant", content: response.content as never });

    const toolUses = response.content.filter(
      (b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use"
    );
    for (const block of response.content) {
      if (block.type === "text" && block.text.trim()) {
        display.push({ kind: "text", text: block.text });
      }
    }

    if (!toolUses.length || response.stop_reason !== "tool_use") break;

    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const use of toolUses) {
      const result = await executeTool(use.name, use.input as Record<string, unknown>, actor);
      display.push({
        kind: "tool",
        tool: use.name,
        input: JSON.stringify(use.input).slice(0, 400),
        result: result.slice(0, 400),
      });
      results.push({ type: "tool_result", tool_use_id: use.id, content: result });
    }
    messages.push({ role: "user", content: results as never });
  }

  return { display, apiMessages: messages, stopReason };
}
