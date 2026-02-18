import type { LLMProvider } from "../providers.js";
import type {
  TaskCondition,
  TaskDefinition,
  TaskOutputKey,
  TaskOutputMap,
  TaskRetryPolicy,
  TaskRuntimeContext,
} from "./types.js";

type RequiredKeys<TValue extends object> = {
  [TKey in keyof TValue]-?: object extends Pick<TValue, TKey> ? never : TKey;
}[keyof TValue];

type LLMTaskModelSettingsField<TSettings extends object> = keyof TSettings extends never
  ? { readonly modelSettings?: undefined }
  : RequiredKeys<TSettings> extends never
    ? { readonly modelSettings?: TSettings }
    : { readonly modelSettings: TSettings };

/**
 * Declarative definition for an LLM-backed task.
 *
 * @remarks
 * `modelSettings` is conditionally required based on the selected model's
 * required settings type.
 */
export type LLMTaskDefinition<
  TOutput = unknown,
  TModel extends string = string,
  TSettingsByModel extends Record<TModel, object> = Record<TModel, Record<string, never>>,
  TSelectedModel extends TModel = TModel,
  TOutputs extends TaskOutputMap = TaskOutputMap,
  TDependencies extends readonly TaskOutputKey<TOutputs>[] = readonly TaskOutputKey<TOutputs>[],
  TTaskId extends string = string,
> = {
  readonly id: TTaskId;
  readonly description?: string;
  readonly after?: TDependencies;
  readonly when?: TaskCondition<TOutputs, TDependencies>;
  readonly retry?: TaskRetryPolicy;
  readonly output: TaskDefinition<TOutput, TOutputs, TDependencies, TTaskId>["output"];
  readonly provider: LLMProvider<TModel, TSettingsByModel>;
  readonly model: TSelectedModel;
  readonly prompt: (
    context: TaskRuntimeContext<TOutputs, TDependencies>,
  ) => string | Promise<string>;
  readonly system?:
    | string
    | ((context: TaskRuntimeContext<TOutputs, TDependencies>) => string | Promise<string>);
} & LLMTaskModelSettingsField<TSettingsByModel[TSelectedModel]>;

/**
 * Adapts an {@link LLMTaskDefinition} into a runtime {@link TaskDefinition}.
 */
export function llmTask<
  TOutput,
  TModel extends string,
  TSettingsByModel extends Record<TModel, object>,
  TSelectedModel extends TModel,
  TOutputs extends TaskOutputMap,
  TDependencies extends readonly TaskOutputKey<TOutputs>[],
  TTaskId extends string,
>(
  definition: LLMTaskDefinition<
    TOutput,
    TModel,
    TSettingsByModel,
    TSelectedModel,
    TOutputs,
    TDependencies,
    TTaskId
  >,
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

      const response = await definition.provider.generateJSON({
        model: definition.model,
        prompt,
        system,
        settings: definition.modelSettings,
      });

      return {
        data: response.data,
        rawOutput: response.rawText,
        input: {
          provider: definition.provider.name,
          model: definition.model,
          prompt,
          ...(system ? { system } : {}),
          ...(definition.modelSettings ? { model_settings: definition.modelSettings } : {}),
        },
        meta: {
          provider: response.provider,
          model: response.model,
          response_id: response.responseId,
          usage: response.usage,
        },
      };
    },
  };
}
