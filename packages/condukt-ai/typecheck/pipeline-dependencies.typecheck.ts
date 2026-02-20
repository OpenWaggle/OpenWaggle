import { z } from "zod";

import { Pipeline, createOpenAIProvider } from "../src/index.js";

const provider = createOpenAIProvider({
  apiKey: "typecheck-key",
  fetchFn: async () =>
    new Response(
      JSON.stringify({
        id: "resp_deps",
        choices: [{ message: { content: "{}" } }],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    ),
});

const pipeline = new Pipeline("typed-dependencies")
  .addLLMTask({
    id: "research",
    provider,
    model: "gpt-4.1-mini",
    output: z.object({
      topics: z.array(z.string()),
    }),
    prompt: ({ dependencyOutputs }) => {
      // @ts-expect-error first task has no dependencies
      dependencyOutputs.research;
      return "{}";
    },
  })
  .addLLMTask({
    id: "draft",
    provider,
    model: "gpt-4.1-mini",
    after: ["research"] as const,
    output: z.object({
      claims: z.array(z.string()),
    }),
    prompt: ({ dependencyOutputs }) => {
      dependencyOutputs.research.topics.join(",");
      // @ts-expect-error verify is not declared dependency
      dependencyOutputs.verify;
      return "{}";
    },
    when: ({ dependencyOutputs }) => dependencyOutputs.research.topics.length > 0,
  });

const pipelineWithVerify = pipeline.addLLMTask({
  id: "verify",
  provider,
  model: "gpt-4.1-mini",
  after: ["draft"] as const,
  output: z.object({
    verified: z.boolean(),
  }),
  prompt: ({ dependencyOutputs }) => {
    dependencyOutputs.draft.claims.length;
    return "{}";
  },
});

async function assertTypedRunOutputs(): Promise<void> {
  const result = await pipelineWithVerify.runDetailed();
  result.outputs.verify?.verified;
  result.outputs.draft?.claims;

  // @ts-expect-error unknown output key
  result.outputs.nonexistent;
}

void assertTypedRunOutputs();

const invalidPipeline = new Pipeline("invalid-dependencies");
invalidPipeline.addLLMTask({
  id: "bad-task",
  provider,
  model: "gpt-4.1-mini",
  // @ts-expect-error missing-task is not a known dependency key
  after: ["missing-task"] as const,
  output: z.object({ ok: z.boolean() }),
  prompt: () => "{}",
});

const duplicateIdPipeline = new Pipeline("duplicate-ids").addLLMTask({
  id: "research",
  provider,
  model: "gpt-4.1-mini",
  output: z.object({ topics: z.array(z.string()) }),
  prompt: () => "{}",
});

// @ts-expect-error duplicate task ids are rejected at compile-time in chained builders
duplicateIdPipeline.addLLMTask({
  id: "research",
  provider,
  model: "gpt-4.1-mini",
  output: z.object({ topics: z.array(z.string()) }),
  prompt: () => "{}",
});
