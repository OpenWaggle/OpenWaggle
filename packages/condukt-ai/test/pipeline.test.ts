import { expect, test } from "vitest";

import { z } from "zod";

import {
  ERROR_CODE_CONTRACT_OUTPUT_VIOLATION,
  type LLMJsonRequest,
  type LLMJsonResponse,
  Pipeline,
  type LLMProvider,
  llmTask,
} from "../src/index.js";

type FakeModel = "fake-model";
type FakeModelSettingsByModel = {
  readonly "fake-model": Record<string, never>;
};

class FakeProvider implements LLMProvider<FakeModel, FakeModelSettingsByModel> {
  readonly name = "fake";
  readonly models = ["fake-model"] as const;

  constructor(private readonly responses: Record<string, unknown>) {}

  async generateJSON<TSelectedModel extends FakeModel>(
    request: LLMJsonRequest<TSelectedModel, FakeModelSettingsByModel[TSelectedModel]>,
  ): Promise<LLMJsonResponse<TSelectedModel>> {
    const data = this.responses[request.prompt];
    if (typeof data === "undefined") {
      throw new Error(`no fake response for prompt '${request.prompt}'`);
    }

    return {
      provider: this.name,
      model: request.model,
      rawText: JSON.stringify(data),
      data,
    };
  }
}

test("runs an LLM pipeline with typed contracts and trace output", async () => {
  const provider = new FakeProvider({
    "research:space elevators": {
      topics: ["history", "materials"],
      sources: ["nasa", "ieee"],
    },
    "draft from history,materials": {
      article: "Space elevators are hypothetical transport systems.",
      claims: ["Carbon nanotubes are a candidate material."],
    },
    "verify claims count=1": {
      verified: true,
      issues: [],
    },
  });

  const pipeline = new Pipeline("research-and-write")
    .addLLMTask({
      id: "research",
      provider,
      model: "fake-model",
      output: z.object({
        topics: z.array(z.string()),
        sources: z.array(z.string()),
      }),
      prompt: () => "research:space elevators",
    })
    .addLLMTask({
      id: "draft",
      after: ["research"] as const,
      provider,
      model: "fake-model",
      output: z.object({
        article: z.string(),
        claims: z.array(z.string()),
      }),
      prompt: ({ dependencyOutputs }) => {
        const research = dependencyOutputs.research;
        return `draft from ${research.topics.join(",")}`;
      },
    })
    .addLLMTask({
      id: "verify",
      after: ["draft"] as const,
      provider,
      model: "fake-model",
      output: z.object({
        verified: z.boolean(),
        issues: z.array(z.string()),
      }),
      prompt: ({ dependencyOutputs }) => {
        const draft = dependencyOutputs.draft;
        return `verify claims count=${draft.claims.length}`;
      },
    });

  const trace = await pipeline.run();

  expect(trace.status).toBe("ok");
  expect(trace.task_order).toEqual(["research", "draft", "verify"]);
  expect(trace.summary.failed).toBe(0);
  expect(trace.tasks.length).toBe(3);
  expect(trace.tasks[2]?.status).toBe("ok");
  expect(trace.tasks[2]?.output).toEqual({ verified: true, issues: [] });
  expect(trace.tasks[1]?.input?.provider).toBe("fake");
});

test("runDetailed returns typed outputs for completed tasks", async () => {
  const provider = new FakeProvider({
    "research:typed": {
      topics: ["contracts"],
      sources: ["schema"],
    },
    "draft typed": {
      claims: ["contracts reduce silent failures"],
    },
  });

  const pipeline = new Pipeline("typed-results")
    .addLLMTask({
      id: "research",
      provider,
      model: "fake-model",
      output: z.object({
        topics: z.array(z.string()),
        sources: z.array(z.string()),
      }),
      prompt: () => "research:typed",
    })
    .addLLMTask({
      id: "draft",
      provider,
      model: "fake-model",
      after: ["research"] as const,
      output: z.object({
        claims: z.array(z.string()),
      }),
      prompt: ({ dependencyOutputs }) =>
        dependencyOutputs.research.topics.length > 0 ? "draft typed" : "draft-empty",
    });

  const result = await pipeline.runDetailed();

  expect(result.trace.status).toBe("ok");
  expect(result.outputs.research?.sources).toEqual(["schema"]);
  expect(result.outputs.draft?.claims).toEqual(["contracts reduce silent failures"]);
  expect(result.taskResults.draft?.status).toBe("ok");
});

test("fails fast with contract diagnostics when a task returns invalid shape", async () => {
  const provider = new FakeProvider({
    research: {
      topics: ["a"],
      sources: ["s"],
    },
    draft: {
      article: "hello",
      claims: "not-a-list",
    },
  });

  const pipeline = new Pipeline("contract-failure");

  pipeline.addTask(
    llmTask({
      id: "research",
      provider,
      model: "fake-model",
      output: z.object({
        topics: z.array(z.string()),
        sources: z.array(z.string()),
      }),
      prompt: () => "research",
    }),
  );

  pipeline.addTask(
    llmTask({
      id: "draft",
      after: ["research"],
      provider,
      model: "fake-model",
      output: z.object({
        article: z.string(),
        claims: z.array(z.string()),
      }),
      prompt: () => "draft",
    }),
  );

  const trace = await pipeline.run();

  expect(trace.status).toBe("failed");
  expect(trace.tasks.length).toBe(2);
  expect(trace.summary.failed).toBe(1);

  const failedTask = trace.tasks[1];
  expect(failedTask?.task).toBe("draft");
  expect(failedTask?.status).toBe("error");
  expect(failedTask?.error_code).toBe(ERROR_CODE_CONTRACT_OUTPUT_VIOLATION);
  expect(failedTask?.error).toBe("task output contract violation");
  expect(Array.isArray(failedTask?.contract_issues)).toBe(true);
  expect(failedTask?.contract_issues?.[0]?.path).toBe("claims");
});

test("rejects unknown dependencies", async () => {
  const provider = new FakeProvider({
    ok: { value: true },
  });

  const pipeline = new Pipeline("bad-deps");
  pipeline.addTask(
    llmTask({
      id: "only_task",
      after: ["missing_task"],
      provider,
      model: "fake-model",
      output: z.object({ value: z.boolean() }),
      prompt: () => "ok",
    }),
  );

  await expect(pipeline.run()).rejects.toThrow(/depends on unknown task 'missing_task'/);
});

test("rejects duplicate task ids at runtime for dynamic task ids", () => {
  const provider = new FakeProvider({
    ok: { value: true },
  });

  const pipeline = new Pipeline("duplicate-ids").addLLMTask({
    id: "research",
    provider,
    model: "fake-model",
    output: z.object({ value: z.boolean() }),
    prompt: () => "ok",
  });

  const duplicateId = "research" as string;

  expect(() =>
    pipeline.addLLMTask({
      id: duplicateId,
      provider,
      model: "fake-model",
      output: z.object({ value: z.boolean() }),
      prompt: () => "ok",
    }),
  ).toThrow(/duplicate task id 'research'/);
});

test("supports conditional task execution and records skipped tasks", async () => {
  const pipeline = new Pipeline("conditional-flow")
    .addTask({
      id: "gate",
      output: z.object({
        shouldRun: z.boolean(),
      }),
      run: async () => ({
        data: { shouldRun: false },
      }),
    })
    .addTask({
      id: "deploy",
      after: ["gate"] as const,
      when: ({ dependencyOutputs }) => dependencyOutputs.gate.shouldRun,
      output: z.object({
        deployed: z.boolean(),
      }),
      run: async () => ({
        data: { deployed: true },
      }),
    });

  const result = await pipeline.runDetailed();
  const deployTrace = result.trace.tasks[1];

  expect(result.trace.status).toBe("ok");
  expect(result.trace.summary).toEqual({
    total: 2,
    passed: 1,
    failed: 0,
    skipped: 1,
  });
  expect(result.outputs.deploy).toBeUndefined();
  expect(deployTrace?.status).toBe("skipped");
  expect(deployTrace?.skip_reason).toBe("condition returned false");
});

test("retries execution failures and succeeds on later attempt", async () => {
  let attempts = 0;
  const provider = new FakeProvider({
    recover: { ok: true },
  });

  const pipeline = new Pipeline("retry-success");
  pipeline.addTask(
    llmTask({
      id: "recoverable",
      provider,
      model: "fake-model",
      retry: {
        retries: 2,
        backoffMs: 0,
        retryIf: "execution_error",
      },
      output: z.object({ ok: z.boolean() }),
      prompt: () => {
        attempts += 1;
        if (attempts === 1) {
          throw new Error("transient failure");
        }
        return "recover";
      },
    }),
  );

  const trace = await pipeline.run();
  expect(trace.status).toBe("ok");
  expect(trace.tasks.length).toBe(1);
  expect(trace.tasks[0]?.status).toBe("ok");
  expect(trace.tasks[0]?.attempts?.length).toBe(2);
  expect(trace.tasks[0]?.attempts?.[0]?.status).toBe("error");
  expect(trace.tasks[0]?.attempts?.[1]?.status).toBe("ok");
});

test("uses injected runtime primitives for deterministic retry behavior", async () => {
  const delays: number[] = [];
  let attempts = 0;

  const pipeline = new Pipeline("deterministic-runtime", {
    runtime: {
      random: () => 0.5,
      sleep: async (delayMs) => {
        delays.push(delayMs);
      },
    },
  }).addTask({
    id: "job",
    retry: {
      retries: 2,
      backoffMs: 10,
      jitterMs: 4,
      retryIf: "execution_error",
    },
    output: z.object({ ok: z.boolean() }),
    run: async () => {
      attempts += 1;
      if (attempts < 3) {
        throw new Error("transient");
      }
      return { data: { ok: true } };
    },
  });

  const trace = await pipeline.run();

  expect(trace.status).toBe("ok");
  expect(delays).toEqual([12, 22]);
});

test("executes independent dependency levels in parallel while keeping deterministic task order", async () => {
  const starts: Record<string, number> = {};

  const pipeline = new Pipeline("parallel-levels")
    .addTask({
      id: "a",
      output: z.object({ value: z.string() }),
      run: async () => {
        starts.a = Date.now();
        await waitMs(80);
        return { data: { value: "A" } };
      },
    })
    .addTask({
      id: "b",
      output: z.object({ value: z.string() }),
      run: async () => {
        starts.b = Date.now();
        await waitMs(80);
        return { data: { value: "B" } };
      },
    })
    .addTask({
      id: "join",
      after: ["a", "b"] as const,
      output: z.object({ values: z.array(z.string()) }),
      run: async ({ dependencyOutputs }) => ({
        data: { values: [dependencyOutputs.a.value, dependencyOutputs.b.value] },
      }),
    });

  const result = await pipeline.runDetailed();
  const startDeltaMs = Math.abs((starts.a ?? 0) - (starts.b ?? 0));

  expect(result.trace.status).toBe("ok");
  expect(result.trace.execution.mode).toBe("level_parallel");
  expect(result.trace.task_order).toEqual(["a", "b", "join"]);
  expect(startDeltaMs).toBeLessThan(50);
  expect(result.outputs.join?.values).toEqual(["A", "B"]);
});

async function waitMs(durationMs: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });
}
