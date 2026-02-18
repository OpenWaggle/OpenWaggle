# condukt-ai (prototype)

TypeScript-first contract and trace runtime for agent workflows.

Focus of this package:
- Standard Schema task contracts (`@standard-schema/spec`) so users can bring Zod or any compliant schema library
- structured execution traces for fast failure diagnosis
- parallel execution across independent dependency levels
- conditional task gating with `when(...)` and skipped-task trace diagnostics
- LLM task adapters for OpenAI and Anthropic JSON workflows
- TanStack AI task adapter (`tanstackChatTask`) for SDK-native chat integrations
- provider-model-aware typing (model IDs + settings inferred per provider/model)
- typed dependency context via `pipeline.addLLMTask(...)` so `dependencyOutputs` matches declared `after` tasks
- duplicate task IDs rejected during typed builder composition (and runtime-guarded for dynamic IDs)
- task-level retry policies (`retries`, `backoffMs`, `jitterMs`, `retryIf`) with attempt history in traces
- Vitest-powered TypeScript test workflow

## Install

From npm:

```bash
pnpm add condukt-ai zod
```

From source:

```bash
pnpm install
```

Commands in this README are shown from the monorepo root.

## Run checks

```bash
pnpm --filter condukt-ai lint
pnpm --filter condukt-ai format
pnpm --filter condukt-ai typecheck
pnpm --filter condukt-ai test
pnpm --filter condukt-ai check
pnpm --filter condukt-ai build
pnpm --filter condukt-ai release:guard
pnpm --filter condukt-ai release:check
```

## 10-minute quickstart

Run successful flow:

```bash
pnpm --filter condukt-ai quickstart
```

Run intentionally broken flow:

```bash
pnpm --filter condukt-ai quickstart:broken
```

Both commands write `packages/core/trace.quickstart.json`. Follow `docs/TRACE_WALKTHROUGH.md` to diagnose the broken run from trace data.

## External trial instrumentation

Capture diagnosis-time metrics for external users:

```bash
pnpm --filter condukt-ai trial:start --participant p1 --scenario quickstart-broken --mode condukt-ai --trace packages/core/trace.quickstart.json
pnpm --filter condukt-ai trial:finish --session packages/core/trials/sessions/<session-id>.session.json --diagnosed-task draft --diagnosed-error-code CONTRACT_OUTPUT_VIOLATION
pnpm --filter condukt-ai trial:report
pnpm --filter condukt-ai trial:report -- --min-records 6 --min-accuracy 0.75 --min-pairs 3 --min-speedup 1.5
pnpm --filter condukt-ai trial:report -- --markdown-out packages/core/trials/report.md --title "Condukt AI Trial Report"
```

Trial protocol details: `docs/TRIALS.md`.

Library consumers can import trial helpers from the dedicated subpath:

```ts
import { summarizeTrialRecords } from "condukt-ai/trials";
```

## Minimal usage

```ts
import { z } from "zod";
import { Pipeline, createOpenAIProvider } from "condukt-ai";

const provider = createOpenAIProvider();

const pipeline = new Pipeline("research-and-write").addLLMTask({
    id: "research",
    provider,
    model: "gpt-4.1-mini",
    modelSettings: {
      temperature: 0.2,
      maxTokens: 300,
    },
    output: z.object({ topics: z.array(z.string()) }),
    prompt: () => "Return JSON with topics.",
  });

const result = await pipeline.runDetailed();
console.log(result.trace.status);
console.log(result.outputs.research?.topics);
```

See `examples/research-write.ts` for a 3-step pipeline example.

## Runtime overrides (deterministic tests)

Inject runtime primitives when you need deterministic retry/backoff behavior:

```ts
const pipeline = new Pipeline("deterministic", {
  runtime: {
    random: () => 0.5,
    sleep: async () => {},
  },
});
```

## TanStack AI adapter

Use `tanstackChatTask` to run a TanStack text adapter inside a Condukt pipeline task:

```ts
import { Pipeline, tanstackChatTask } from "condukt-ai";

const pipeline = new Pipeline("tanstack").addTask(
  tanstackChatTask({
    id: "research",
    adapter: openaiText("gpt-4o-mini"),
    output: z.object({ topics: z.array(z.string()) }),
    prompt: () => "Return JSON with a topics array.",
    system: "Always respond with valid JSON.",
  }),
);
```

`tanstackChatTask` executes `chat({ stream: false })` and parses JSON text for contract validation.
