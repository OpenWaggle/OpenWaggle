import { z } from "zod";

import { createAnthropicProvider, createOpenAIProvider, llmTask } from "../src/index.js";

const openai = createOpenAIProvider({
  apiKey: "typecheck-key",
  fetchFn: async () =>
    new Response(
      JSON.stringify({
        id: "resp_typecheck",
        choices: [{ message: { content: "{}" } }],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    ),
});

llmTask({
  id: "openai-chat",
  provider: openai,
  model: "gpt-4.1-mini",
  modelSettings: {
    temperature: 0.2,
    maxTokens: 120,
  },
  output: z.object({ ok: z.boolean() }),
  prompt: () => "{}",
});

llmTask({
  id: "openai-reasoning",
  provider: openai,
  model: "o4-mini",
  modelSettings: {
    reasoningEffort: "high",
    maxTokens: 400,
  },
  output: z.object({ ok: z.boolean() }),
  prompt: () => "{}",
});

llmTask({
  id: "openai-reasoning-invalid-temperature",
  provider: openai,
  model: "o4-mini",
  modelSettings: {
    // @ts-expect-error reasoning models do not accept temperature
    temperature: 0.3,
  },
  output: z.object({ ok: z.boolean() }),
  prompt: () => "{}",
});

llmTask({
  id: "openai-chat-invalid-reasoning",
  provider: openai,
  model: "gpt-4.1-mini",
  modelSettings: {
    // @ts-expect-error chat models do not accept reasoningEffort
    reasoningEffort: "high",
  },
  output: z.object({ ok: z.boolean() }),
  prompt: () => "{}",
});

const anthropic = createAnthropicProvider({
  apiKey: "typecheck-key",
  fetchFn: async () =>
    new Response(
      JSON.stringify({
        id: "msg_typecheck",
        content: [{ type: "text", text: "{}" }],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    ),
});

llmTask({
  id: "anthropic-valid",
  provider: anthropic,
  model: "claude-sonnet-4-5-20250929",
  modelSettings: {
    maxTokens: 800,
    temperature: 0.1,
  },
  output: z.object({ ok: z.boolean() }),
  prompt: () => "{}",
});

llmTask({
  id: "anthropic-invalid-model",
  provider: anthropic,
  // @ts-expect-error unsupported Anthropic model id
  model: "claude-invalid-model",
  output: z.object({ ok: z.boolean() }),
  prompt: () => "{}",
});
