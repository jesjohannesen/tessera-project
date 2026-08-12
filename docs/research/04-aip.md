# Slice 4: AIP (AI Platform)

## Core primitives

- **AIP Logic** — a no-code environment for building, testing, and releasing functions powered by LLMs that leverage the Ontology. A Logic function has typed inputs/outputs (array, boolean, date, object, object list, object set, struct, timestamp, media reference, model, etc.) and is composed of sequential **blocks**: **Use LLM**, **Apply Action** (deterministic ontology edit, no LLM), **Execute Function** (TypeScript/Python/other Logic functions), **Conditionals**, **Loops**, **Create Variable**. The **Use LLM block** is the heart: a prompt + attached tools + typed output. Attachable tools: **Query Objects** (grants the LLM read access to specified object types/properties), **Apply Actions** (ontology edits via pre-configured Actions), **Call Function**, **Calculator**. Critical caveat: ontology edits only persist when the Logic function is executed *from* an Action — running it standalone stages but does not write edits.
- **Publishing/reuse of Logic functions** — once published they become ordinary Foundry functions: backing for **function-backed Actions** in Workshop workflows, callable from other functions, usable in Workshop widgets, triggerable as effects in **Automate**, invocable via API, and testable in AIP Evals.
- **AIP Agent Studio → AIP Chatbot Studio** (renamed) — builds persistent interactive assistants "equipped with enterprise-specific information and tools, deployable internally in the platform and externally through the Ontology SDK and platform APIs." Core concepts: **system prompt**, **retrieval context** (RAG over configured sources, with citations), **tools**, **application state** (application variables readable/writable by the chatbot, bridging chat and a Workshop app's live UI state), and a **context window** of system prompt + conversation history + injected context. Chatbots can be published as Functions (usable in Evals, Automate, code) and distributed via Marketplace; embeddable in Workshop via the AIP Chatbot widget.
- **Chatbot tool types** (six): **Action** (ontology edits, configurable to run automatically or only after user confirmation), **Object Query** (filter/aggregate/inspect/link-traverse over granted object types), **Function** (any Foundry function incl. published Logic), **Update Application Variable**, **Command** (drive other Palantir applications), **Request Clarification** (pause and ask the user). Two tool-calling modes: **Prompted Tool Calling** (tool instructions injected into the prompt, one tool at a time) vs **Native Tool Calling** (model's built-in function calling, parallel calls).
- **AIP Assist** — the in-platform copilot. Answers from platform documentation and developer docs; context-aware of which application you're in but explicitly "does not have access to any data or metadata that you are working with."
- **AIP Threads** — lightweight ad-hoc LLM productivity surface: drag-and-drop documents or converse with published Chatbots, no configuration required.
- **Model Catalog** — lists LLMs available in the enrollment (OpenAI, Anthropic, Google Gemini, Mistral families; completion/embedding/vision types) with lifecycle status (Experimental/Stable/Sunset/Deprecated). Admins enable models in Control Panel; includes a playground and generates starter resources pre-wired to a model. BYO-model registration and LLM-provider-compatible proxy APIs also exist.
- **AIP Evals** — testing environment for AIP Logic functions, Chatbot functions, or code-authored functions. Primitives: **evaluation suite** = test cases + target functions + evaluation functions; **test case** = input + expected output; **evaluator** returns boolean or numeric metrics (e.g. semantic distance); metrics aggregate across runs for comparison across prompts/models. Supports multiple target functions per suite, evaluating **ontology edits** as outputs, and auto-generation of suites ("Generate evals").
- **Automate** — condition→effect automation over the ontology: **time-based conditions** (schedules), **object data conditions** ("trigger when a new Alert object with priority high is added"), and streaming conditions; effects are submit Actions, trigger AIP Logic functions, execute Foundry functions, and send notifications. Runs under **scoped** or **user** permission modes.

## Architecture notes

- **LLM-as-governed-function-over-ontology.** The unifying pattern: an LLM invocation is packaged as a *typed function* whose only channels to data are ontology primitives — object queries for reads, Actions for writes. The docs are explicit about mediation: "LLMs do not have direct access to tools; LLMs can only ask to use tools," which the runtime then executes within the caller's permissions. Security is inherited, not bolted on: ontology-level permissions mean an agent acting for a user cannot read or edit anything the user couldn't.
- **Writes are double-gated.** The LLM can propose an Action call, but (a) the Action itself carries submission criteria/permissions, (b) in Logic, edits persist only when invoked through an Action, and (c) in Chatbots, Action tools can be configured to require explicit user confirmation. Automate adds "staged for human review" as a first-class alternative to auto-apply — propose-then-promote at the platform level.
- **Model access is centrally brokered.** All LLM traffic goes through the platform's LLM proxy endpoints enforcing zero-data-retention and georestriction; capacity is managed at three levels (enrollment ceiling → project rate limits → per-user limits). Admins choose which models/lifecycle tiers are enabled.
- **The eval loop closes the system.** Because Logic functions and Chatbots are functions, they slot directly into Evals: build → debug (chain-of-thought debugger showing generated prompts and tool calls) → evaluation suite → compare metrics across model/prompt versions → republish. Ontology-edit outputs are themselves evaluable.

## Patterns worth emulating

1. **Everything is a function.** LLM chains, agents, and code share one function abstraction, so one eval harness, one action-backing mechanism, and one automation trigger system cover all of them.
2. **Tools are ontology verbs, not raw APIs.** Read = object query over explicitly granted types/properties; write = pre-defined Action with its own validation. The LLM never gets SQL or generic HTTP.
3. **Mediated tool execution.** The runtime — not the model — executes tools, under the invoking user's identity, with per-tool grants and optional human confirmation on side effects.
4. **Writes only via Actions, optionally staged** for review (propose-then-promote).
5. **Evals as a first-class sibling** of the builder, with auto-generated suites lowering the activation energy.
6. **Application state as a chat↔UI bridge** — agent reads and writes named app variables instead of screen-scraping UI.

## Minimal recreation blueprint

Lean web stack: ontology metadata in Postgres, Claude API, and a thin governed-tool runtime.

1. **Tool schema generation from ontology metadata.** At session start, compile the user's *visible* object types and *executable* actions into Claude `tools`: one generic `query_objects` tool whose JSON Schema enums are populated from granted object types/properties (filters, aggregations, link traversal), plus one tool per Action generated from its parameter schema. Descriptions come from ontology metadata doc strings.
2. **Action permission checks.** Every `tool_use` is executed server-side under the requesting user's grants: re-check type/property visibility on queries; on actions, validate parameters against the schema, run submission criteria, then either apply or insert a `proposed_edit` row (status: pending review) — propose-then-promote gate. Flag each action `auto | confirm`; `confirm` returns a diff card the user approves before commit. Log every call for audit.
3. **Functions layer.** Persist a "Logic function" as JSON: typed input schema, block list (llm/act/execute/condition/loop), tool grants. Expose published functions as callable tools to other functions/agents, and as Automate effects triggered by object-change events (Postgres triggers or an outbox table).
4. **Eval harness.** Table of suites → test cases (input JSON, expected output/edits) → evaluators (exact-match, numeric tolerance, embedding distance, Claude-as-judge). Run suite = execute target function per case in a sandbox transaction (rolled back), store per-case metrics, diff aggregate metrics across function versions/models. Add a "generate evals" endpoint.
5. **Model governance (lean).** A models table (id, provider, status) + per-user token budget middleware in the Claude proxy route.

## Key doc URLs

- https://www.palantir.com/docs/foundry/aip/overview
- https://www.palantir.com/docs/foundry/logic/overview
- https://www.palantir.com/docs/foundry/logic/blocks
- https://www.palantir.com/docs/foundry/chatbot-studio/core-concepts
- https://www.palantir.com/docs/foundry/chatbot-studio/tools
- https://www.palantir.com/docs/foundry/chatbot-studio/application-state
- https://www.palantir.com/docs/foundry/assist/overview
- https://www.palantir.com/docs/foundry/threads/overview
- https://www.palantir.com/docs/foundry/aip-evals/overview
- https://www.palantir.com/docs/foundry/aip-evals/ontology-edits
- https://www.palantir.com/docs/foundry/model-catalog/overview
- https://www.palantir.com/docs/foundry/aip/supported-llms
- https://www.palantir.com/docs/foundry/aip/llm-capacity-management
- https://www.palantir.com/docs/foundry/aip/bring-your-own-model
- https://www.palantir.com/docs/foundry/aip/aip-security
- https://www.palantir.com/docs/foundry/automate/overview
