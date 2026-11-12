import type {
  extensionRuntimeRegisterContributionResultSchema,
  extensionRuntimeUnregisterContributionResultSchema,
} from './broker-schemas-storage.js'
import type { SchemaType } from './schema.js'

export type ExtensionRuntimeRegisterContributionResult = SchemaType<
  typeof extensionRuntimeRegisterContributionResultSchema
>
export type ExtensionRuntimeUnregisterContributionResult = SchemaType<
  typeof extensionRuntimeUnregisterContributionResultSchema
>
