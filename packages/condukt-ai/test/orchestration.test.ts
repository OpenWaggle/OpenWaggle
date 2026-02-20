import { expect, test } from "vitest";

import {
  createOrchestrationEngine,
  MemoryRunStore,
  ORCHESTRATION_ERROR_TASK_TIMEOUT,
  type OrchestrationRunRecord,
  type WorkerAdapter,
} from "../src/index.js";

test("executes dependency graph and allows dynamic spawn", async () => {
  const worker: WorkerAdapter = {
    async executeTask(task, context) {
      if (task.kind === "root") {
        await context.spawn({ id: "spawned", kind: "echo", input: { value: "child" } });
        return { output: { root: true } };
      }
      if (task.kind === "echo") {
        return { output: task.input };
      }
      if (task.kind === "join") {
        return {
          output: {
            fromA: context.dependencyOutputs.a,
            fromB: context.dependencyOutputs.b,
          },
        };
      }
      throw new Error(`unexpected kind ${task.kind}`);
    },
  };

  const store = new MemoryRunStore();
  const engine = createOrchestrationEngine({ workerAdapter: worker, runStore: store });

  const summary = await engine.run({
    runId: "run-spawn",
    tasks: [
      { id: "a", kind: "echo", input: { v: "A" } },
      { id: "b", kind: "root" },
      { id: "join", kind: "join", dependsOn: ["a", "b"] },
    ],
  });

  expect(summary.status).toBe("completed");
  expect(summary.outputs.join).toEqual({
    fromA: { v: "A" },
    fromB: { root: true },
  });

  const run = await store.getRun("run-spawn");
  expect(run?.tasks.spawned?.status).toBe("completed");
});

test("retries task execution failures with backoff", async () => {
  let attempts = 0;
  const delays: number[] = [];

  const worker: WorkerAdapter = {
    async executeTask(task) {
      if (task.kind !== "flaky") {
        return { output: null };
      }
      attempts += 1;
      if (attempts < 3) {
        throw new Error("transient");
      }
      return { output: { ok: true } };
    },
  };

  const engine = createOrchestrationEngine({
    workerAdapter: worker,
    random: () => 0,
    sleep: async (delayMs) => {
      delays.push(delayMs);
    },
  });

  const summary = await engine.run({
    runId: "run-retry",
    tasks: [
      {
        id: "task",
        kind: "flaky",
        retry: { retries: 2, backoffMs: 10, jitterMs: 0 },
      },
    ],
  });

  expect(summary.status).toBe("completed");
  expect(summary.outputs.task).toEqual({ ok: true });
  expect(delays).toEqual([10, 20]);
});

test("marks timed out tasks as failed with timeout code", async () => {
  const worker: WorkerAdapter = {
    async executeTask(_task, context) {
      await new Promise<void>((resolve) => {
        context.signal.addEventListener("abort", () => resolve(), { once: true });
      });
      throw new Error("timeout triggered");
    },
  };

  const store = new MemoryRunStore();
  const engine = createOrchestrationEngine({ workerAdapter: worker, runStore: store });

  const summary = await engine.run({
    runId: "run-timeout",
    tasks: [{ id: "slow", kind: "slow", timeoutMs: 10 }],
  });

  expect(summary.status).toBe("failed");
  expect(summary.failedTaskIds).toEqual(["slow"]);

  const run = await store.getRun("run-timeout");
  expect(run?.tasks.slow?.errorCode).toBe(ORCHESTRATION_ERROR_TASK_TIMEOUT);
});

test("supports run cancellation", async () => {
  const worker: WorkerAdapter = {
    async executeTask(_task, context) {
      await new Promise<void>((resolve) => {
        context.signal.addEventListener("abort", () => resolve(), { once: true });
      });
      throw new Error("aborted");
    },
  };

  const store = new MemoryRunStore();
  const engine = createOrchestrationEngine({ workerAdapter: worker, runStore: store });

  const runPromise = engine.run({
    runId: "run-cancel",
    tasks: [{ id: "long", kind: "long" }],
  });

  await engine.cancel("run-cancel", "user-cancel");
  const summary = await runPromise;

  expect(summary.status).toBe("cancelled");
  expect(summary.cancelledTaskIds).toContain("long");
});

test("resumes from persisted non-terminal checkpoint", async () => {
  const worker: WorkerAdapter = {
    async executeTask(task, context) {
      if (task.kind === "combine") {
        const left = context.dependencyOutputs.left as { value: string };
        return { output: { merged: `${left.value}-done` } };
      }
      return { output: { value: String(task.input ?? "") } };
    },
  };

  const store = new MemoryRunStore();

  const checkpoint: OrchestrationRunRecord = {
    runId: "run-resume",
    status: "running",
    startedAt: new Date().toISOString(),
    tasks: {
      left: {
        id: "left",
        kind: "echo",
        dependsOn: [],
        input: "left",
        output: { value: "left" },
        status: "completed",
        retry: { retries: 0, backoffMs: 0, jitterMs: 0 },
        attempts: [],
        createdOrder: 0,
      },
      right: {
        id: "right",
        kind: "combine",
        dependsOn: ["left"],
        status: "queued",
        retry: { retries: 0, backoffMs: 0, jitterMs: 0 },
        attempts: [],
        createdOrder: 1,
      },
    },
    taskOrder: ["left", "right"],
    outputs: { left: { value: "left" } },
    summary: {
      total: 2,
      completed: 1,
      failed: 0,
      cancelled: 0,
      queued: 1,
      running: 0,
      retrying: 0,
    },
  };

  await store.saveRun(checkpoint);

  const engine = createOrchestrationEngine({ workerAdapter: worker, runStore: store });
  const summary = await engine.resume("run-resume");

  expect(summary.status).toBe("completed");
  expect(summary.outputs.right).toEqual({ merged: "left-done" });
});
