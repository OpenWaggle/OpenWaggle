export type { StandardSchemaV1 } from "@standard-schema/spec";

export {
  ERROR_CODE_CONTRACT_OUTPUT_VIOLATION,
  ERROR_CODE_TASK_DEPENDENCY_MISSING,
  ERROR_CODE_TASK_EXECUTION_FAILURE,
  Pipeline,
  TRACE_VERSION,
  llmTask,
} from "./pipeline.js";

export type {
  LLMTaskDefinition,
  PipelineOptions,
  PipelineRunResult,
  PipelineTrace,
  TaskDefinition,
  TaskExecutionResult,
  TaskRetryPolicy,
  TaskRuntimeContext,
  TaskTrace,
} from "./pipeline.js";

export { tanstackChatTask } from "./tanstack.js";
export type { TanStackChatTaskDefinition } from "./tanstack.js";

export {
  ANTHROPIC_MODELS,
  OPENAI_MODELS,
  createAnthropicProvider,
  createOpenAIProvider,
} from "./providers.js";

export type {
  AnthropicModel,
  AnthropicModelSettings,
  AnthropicModelSettingsByModel,
  AnthropicProviderOptions,
  LLMJsonRequest,
  LLMJsonResponse,
  LLMProvider,
  OpenAIChatModel,
  OpenAIChatModelSettings,
  OpenAIModel,
  OpenAIModelSettingsByModel,
  OpenAIProviderOptions,
  OpenAIReasoningModel,
  OpenAIReasoningModelSettings,
  ProviderModelName,
  ProviderModelSettings,
} from "./providers.js";

export { validateContract } from "./contracts.js";
export type { ContractIssue, ContractValidationResult } from "./contracts.js";

export { diagnoseFailure } from "./diagnostics.js";
export type { FailureDiagnosis } from "./diagnostics.js";
