/**
 * The broker's invoke types, each inferred from its internal schema and printed into
 * `src/generated/broker.ts` by `scripts/generate-extension-sdk-types.ts`.
 */
import type * as Core from '../broker-schemas-core.js'
import type * as Result from '../broker-schemas-result.js'
import type { SchemaType } from '../schema.js'

/** Why a broker call failed. */
export type ExtensionInvokeFailureCode = SchemaType<typeof Core.extensionInvokeFailureCodeSchema>
/** Whether the broker ran a call or refused it. */
export type ExtensionInvokeOutcome = SchemaType<typeof Core.extensionInvokeOutcomeSchema>
/** Where a broker call applies: the app, a project, a session or a branch. */
export type ExtensionInvokeScope = SchemaType<typeof Core.extensionInvokeScopeSchema>
/** One broker call as the host receives it. */
export type ExtensionInvokeInput = SchemaType<typeof Core.extensionInvokeInputSchema>
/** Why the broker refused or failed a call. */
export type ExtensionInvokeError = SchemaType<typeof Core.extensionInvokeErrorSchema>
/** The audit record the broker keeps for every call. */
export type ExtensionCapabilityAuditEntry = SchemaType<
  typeof Core.extensionCapabilityAuditEntrySchema
>
/** A broker call that failed. */
export type ExtensionInvokeFailure = SchemaType<typeof Result.extensionInvokeFailureSchema>
/** The result of `hostContext.getScope`: the scope the host resolved for the contribution. */
export type ExtensionHostContextResult = SchemaType<typeof Core.extensionHostContextResultSchema>
