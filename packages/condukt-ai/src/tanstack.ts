import type { StandardSchemaV1 } from "@standard-schema/spec";
import { chat, type AnyTextAdapter } from "@tanstack/ai";

import { parseJsonText } from "./json.js";
import type { TaskDefinition, TaskRetryPolicy, TaskRuntimeContext } from "./pipeline.js";

type TaskOutputMap = Record<string, unknown>;
type TaskOutputKey<TOutputs extends TaskOutputMap> = Extract<keyof TOutputs, string>;
type MaybePromise<TValue> = TValue | Promise<TValue>;

/** Additional options forwarded to `@tanstack/ai` chat execution. */
export interface TanStackTaskChatOptions<TAdapter extends AnyTextAdapter> {
  readonly temperature?: number;
  readonly topP?: number;
  readonly maxTokens?: number;
  readonly metadata?: Record<string, unknown>;
  readonly modelOptions?: TAdapter["~types"]["providerOptions"];
}

/**
 * Declarative task definition for TanStack AI chat adapters.
 */
export interface TanStackChatTaskDefinition<
  TOutput = unknown,
  TAdapter extends AnyTextAdapter = AnyTextAdapter,
  TOutputs extends TaskOutputMap = TaskOutputMap,
  TDependencies extends readonly TaskOutputKey<TOutputs>[] = readonly TaskOutputKey<TOutputs>[],
  TTaskId extends string = string,
> {
  readonly id: TTaskId;
  readonly description?: string;
  readonly after?: TDependencies;
  readonly when?: (context: TaskRuntimeContext<TOutputs, TDependencies>) => MaybePromise<boolean>;
  readonly retry?: TaskRetryPolicy;
  readonly output: StandardSchemaV1<unknown, TOutput>;
  readonly adapter: TAdapter;
  readonly prompt: (context: TaskRuntimeContext<TOutputs, TDependencies>) => MaybePromise<string>;
  readonly system?:
    | string
    | ((context: TaskRuntimeContext<TOutputs, TDependencies>) => MaybePromise<string>);
  readonly options?:
    | TanStackTaskChatOptions<TAdapter>
    | ((
        context: TaskRuntimeContext<TOutputs, TDependencies>,
      ) => MaybePromise<TanStackTaskChatOptions<TAdapter>>);
}

/**
 * Builds a Condukt task from a TanStack AI adapter.
 *
 * @remarks
 * The adapter response is expected to be JSON text that satisfies `output`.
 */
export function tanstackChatTask<
  TOutput,
  TAdapter extends AnyTextAdapter,
  TOutputs extends TaskOutputMap,
  TDependencies extends readonly TaskOutputKey<TOutputs>[],
  const TTaskId extends string,
>(
  definition: TanStackChatTaskDefinition<TOutput, TAdapter, TOutputs, TDependencies, TTaskId>,
): TaskDefinition<TOutput, TOutputs, TDependencies, TTaskId> {
  return {
    id: definition.id,
    description: definition.description,
    after: definition.after,
    when: definition.when,
    retry: definition.retry,
    output: definition.output,
    async run(context) {
      const prompt = await definition.prompt(context);
      const system =
        typeof definition.system === "function"
          ? await definition.system(context)
          : definition.system;
      const options =
        typeof definition.options === "function"
          ? await definition.options(context)
          : definition.options;

      const rawOutput = await chat<TAdapter, undefined, false>({
        adapter: definition.adapter,
        stream: false,
        messages: [{ role: "user", content: prompt }],
        ...(system ? { systemPrompts: [system] } : {}),
        ...(options ?? {}),
      });

      const data = parseJsonText(rawOutput, {
        provider: definition.adapter.name,
        maxPreviewChars: 160,
        formatError: ({ provider, preview }) =>
          `${provider} response did not contain valid JSON: ${preview}`,
      });

      return {
        data,
        rawOutput,
        input: {
          provider: `tanstack:${definition.adapter.name}`,
          model: definition.adapter.model,
          prompt,
          ...(system ? { system } : {}),
          ...(options ? { options } : {}),
        },
        meta: {
          provider: definition.adapter.name,
          model: definition.adapter.model,
          transport: "tanstack-ai/chat",
        },
      };
    },
  };
}
