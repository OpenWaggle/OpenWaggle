import { z } from "zod";

import { Pipeline, createOpenAIProvider } from "../src/index.js";

async function main(): Promise<void> {
  const provider = createOpenAIProvider();

  const pipeline = new Pipeline("research-and-write")
    .addLLMTask({
      id: "research",
      provider,
      model: "gpt-4.1-mini",
      modelSettings: {
        temperature: 0.2,
        maxTokens: 700,
      },
      output: z.object({
        topics: z.array(z.string()),
        sources: z.array(z.string()),
      }),
      prompt: () =>
        [
          "Return valid JSON.",
          "Research the topic: reusable launch vehicles.",
          'Output shape: {"topics": string[], "sources": string[]}',
        ].join("\n"),
    })
    .addLLMTask({
      id: "draft",
      after: ["research"] as const,
      provider,
      model: "gpt-4.1-mini",
      modelSettings: {
        temperature: 0.4,
        maxTokens: 900,
      },
      output: z.object({
        article: z.string(),
        claims: z.array(z.string()),
      }),
      prompt: ({ dependencyOutputs }) => {
        const research = dependencyOutputs.research;

        return [
          "Return valid JSON.",
          `Write a short article using topics: ${research.topics.join(", ")}`,
          `Use these sources: ${research.sources.join(", ")}`,
          'Output shape: {"article": string, "claims": string[]}',
        ].join("\n");
      },
    })
    .addLLMTask({
      id: "verify",
      after: ["draft"] as const,
      provider,
      model: "gpt-4.1-mini",
      modelSettings: {
        maxTokens: 500,
      },
      output: z.object({
        verified: z.boolean(),
        issues: z.array(z.string()),
      }),
      prompt: ({ dependencyOutputs }) => {
        const draft = dependencyOutputs.draft;

        return [
          "Return valid JSON.",
          "Check these claims for factual support and consistency:",
          ...draft.claims.map((claim, index) => `${index + 1}. ${claim}`),
          'Output shape: {"verified": boolean, "issues": string[]}',
        ].join("\n");
      },
    });

  const trace = await pipeline.run();
  console.log(JSON.stringify(trace, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
