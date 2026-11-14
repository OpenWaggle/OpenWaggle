/**
 * The union of every broker result value, inferred from its internal schema and printed into
 * `src/generated/broker-result.ts` by `scripts/generate-extension-sdk-types.ts`.
 */
import type * as Result from '../broker-schemas-result.js'
import type { SchemaType } from '../schema.js'

/** Every result value the broker returns, one per capability method. */
export type ExtensionInvokeSuccessValue = SchemaType<
  typeof Result.extensionInvokeSuccessValueSchema
>
