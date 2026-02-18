import type { AnyTextAdapter } from "@tanstack/ai";
import { beforeEach, expect, test, vi } from "vitest";
import { z } from "zod";

import { ERROR_CODE_TASK_EXECUTION_FAILURE, Pipeline, tanstackChatTask } from "../src/index.js";

const hoisted = vi.hoisted(() => ({
  chatMock: vi.fn<typeof import("@tanstack/ai")["chat"]>(),
}));

vi.mock("@tanstack/ai", () => ({
  chat: hoisted.chatMock,
}));

const fakeAdapter = {
  kind: "text",
  name: "tanstack-fake",
  model: "fake-model",
} as unknown as AnyTextAdapter;

beforeEach(() => {
  hoisted.chatMock.mockReset();
});

test("runs a tanstack task and validates output through pipeline contracts", async () => {
  hoisted.chatMock.mockResolvedValueOnce(
    JSON.stringify({
      summary: "typed handoffs",
      score: 0.93,
    }),
  );

  const pipeline = new Pipeline("tanstack-success")
    .addTask({
      id: "seed",
      output: z.object({ topic: z.string() }),
      run: async () => ({
        data: { topic: "typed handoffs" },
      }),
    })
    .addTask(
      tanstackChatTask({
        id: "analyze",
        after: ["seed"] as const,
        adapter: fakeAdapter,
        output: z.object({
          summary: z.string(),
          score: z.number(),
        }),
        system: "Respond with strict JSON only.",
        options: ({ dependencyOutputs }) => ({
          temperature: 0.1,
          metadata: {
            topic: dependencyOutputs.seed.topic,
          },
        }),
        prompt: ({ dependencyOutputs }) =>
          `Analyze this topic and return JSON: ${dependencyOutputs.seed.topic}`,
      }),
    );

  const result = await pipeline.runDetailed();

  expect(result.trace.status).toBe("ok");
  expect(result.outputs.analyze).toEqual({
    summary: "typed handoffs",
    score: 0.93,
  });
  expect(hoisted.chatMock).toHaveBeenCalledTimes(1);
  expect(hoisted.chatMock).toHaveBeenCalledWith({
    adapter: fakeAdapter,
    stream: false,
    systemPrompts: ["Respond with strict JSON only."],
    temperature: 0.1,
    metadata: {
      topic: "typed handoffs",
    },
    messages: [
      {
        role: "user",
        content: "Analyze this topic and return JSON: typed handoffs",
      },
    ],
  });
});

test("returns execution failure when tanstack text output is not valid JSON", async () => {
  hoisted.chatMock.mockResolvedValueOnce("not-json");

  const pipeline = new Pipeline("tanstack-invalid-json").addTask(
    tanstackChatTask({
      id: "broken",
      adapter: fakeAdapter,
      output: z.object({ ok: z.boolean() }),
      prompt: () => "return malformed content",
    }),
  );

  const trace = await pipeline.run();

  expect(trace.status).toBe("failed");
  expect(trace.tasks.length).toBe(1);
  expect(trace.tasks[0]?.status).toBe("error");
  expect(trace.tasks[0]?.error_code).toBe(ERROR_CODE_TASK_EXECUTION_FAILURE);
  expect(trace.tasks[0]?.error).toContain("did not contain valid JSON");
});
