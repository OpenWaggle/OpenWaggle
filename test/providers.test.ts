import { expect, test } from "vitest";

import { createAnthropicProvider, createOpenAIProvider } from "../src/index.js";

test("openai provider parses JSON chat completion responses", async () => {
  let postedBody: unknown;
  const provider = createOpenAIProvider({
    apiKey: "test-key",
    fetchFn: async (_url, init) => {
      postedBody = parseRequestBody(init?.body);
      return new Response(
        JSON.stringify({
          id: "resp_123",
          choices: [
            {
              message: {
                content: '{"ok":true,"issues":[]}',
              },
            },
          ],
          usage: { total_tokens: 123 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    },
  });

  const result = await provider.generateJSON({
    model: "gpt-4.1-mini",
    prompt: "Return JSON",
    settings: {
      temperature: 0.2,
      maxTokens: 320,
    },
  });

  expect(result.provider).toBe("openai");
  expect(result.model).toBe("gpt-4.1-mini");
  expect(result.data).toEqual({ ok: true, issues: [] });
  expect(result.responseId).toBe("resp_123");

  expect(postedBody).toMatchObject({
    model: "gpt-4.1-mini",
    temperature: 0.2,
    max_tokens: 320,
  });
});

test("openai reasoning model supports reasoning settings", async () => {
  let postedBody: unknown;
  const provider = createOpenAIProvider({
    apiKey: "test-key",
    fetchFn: async (_url, init) => {
      postedBody = parseRequestBody(init?.body);
      return new Response(
        JSON.stringify({
          id: "resp_456",
          choices: [
            {
              message: {
                content: '{"ok":true}',
              },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    },
  });

  const result = await provider.generateJSON({
    model: "o4-mini",
    prompt: "Return JSON",
    settings: {
      maxTokens: 512,
      reasoningEffort: "high",
    },
  });

  expect(result.model).toBe("o4-mini");
  expect(postedBody).toMatchObject({
    model: "o4-mini",
    max_tokens: 512,
    reasoning_effort: "high",
  });
});

test("anthropic provider parses JSON text blocks", async () => {
  let postedBody: unknown;
  const provider = createAnthropicProvider({
    apiKey: "test-key",
    fetchFn: async (_url, init) => {
      postedBody = parseRequestBody(init?.body);
      return new Response(
        JSON.stringify({
          id: "msg_123",
          content: [{ type: "text", text: '{"verified":false,"issues":["missing source"]}' }],
          usage: { input_tokens: 10, output_tokens: 20 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    },
  });

  const result = await provider.generateJSON({
    model: "claude-sonnet-4-5-20250929",
    prompt: "Return JSON",
    settings: {
      maxTokens: 900,
      temperature: 0.1,
    },
  });

  expect(result.provider).toBe("anthropic");
  expect(result.model).toBe("claude-sonnet-4-5-20250929");
  expect(result.data).toEqual({
    verified: false,
    issues: ["missing source"],
  });
  expect(result.responseId).toBe("msg_123");
  expect(postedBody).toMatchObject({
    model: "claude-sonnet-4-5-20250929",
    max_tokens: 900,
    temperature: 0.1,
  });
});

function parseRequestBody(body: BodyInit | null | undefined): unknown {
  if (!body) {
    return undefined;
  }

  if (typeof body === "string") {
    return JSON.parse(body);
  }

  if (body instanceof URLSearchParams) {
    return body.toString();
  }

  throw new Error("unexpected body type in provider test");
}
