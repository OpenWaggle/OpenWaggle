import { OPENWAGGLE_EXTENSION_BROKER } from '@shared/constants/extension-broker'
import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import { Schema, type SchemaType } from '@shared/schema'
import { extensionContributionIdSchema, extensionIdSchema } from './extensions'

const nonEmptyStringSchema = Schema.String.pipe(Schema.filter((value) => value.trim().length > 0))

export const extensionInvokeAppScopeSchema = Schema.Struct({
  kind: Schema.Literal('app'),
})

export const extensionInvokeProjectScopeSchema = Schema.Struct({
  kind: Schema.Literal('project'),
  projectPath: nonEmptyStringSchema,
})

export const extensionInvokeSessionScopeSchema = Schema.Struct({
  kind: Schema.Literal('session'),
  projectPath: nonEmptyStringSchema,
  sessionId: nonEmptyStringSchema,
})

export const extensionInvokeBranchScopeSchema = Schema.Struct({
  kind: Schema.Literal('branch'),
  projectPath: nonEmptyStringSchema,
  sessionId: nonEmptyStringSchema,
  branchId: nonEmptyStringSchema,
})

export const extensionInvokeScopeSchema = Schema.Union(
  extensionInvokeAppScopeSchema,
  extensionInvokeProjectScopeSchema,
  extensionInvokeSessionScopeSchema,
  extensionInvokeBranchScopeSchema,
)

export const extensionInvokeInputSchema = Schema.Struct({
  extensionId: extensionIdSchema,
  contributionId: extensionContributionIdSchema,
  capability: extensionContributionIdSchema,
  method: extensionContributionIdSchema,
  scope: extensionInvokeScopeSchema,
  payload: Schema.optional(Schema.Unknown),
})

export const extensionInvokeFailureCodeSchema = Schema.Literal(
  ...OPENWAGGLE_EXTENSION_BROKER.FAILURE_CODES,
)

export const extensionInvokeOutcomeSchema = Schema.Literal(...OPENWAGGLE_EXTENSION_BROKER.OUTCOMES)

export const extensionCapabilityAuditEntrySchema = Schema.Struct({
  extensionId: extensionIdSchema,
  contributionId: extensionContributionIdSchema,
  capability: extensionContributionIdSchema,
  method: extensionContributionIdSchema,
  scope: extensionInvokeScopeSchema,
  outcome: extensionInvokeOutcomeSchema,
  timestamp: Schema.Number,
  failureCode: Schema.optional(extensionInvokeFailureCodeSchema),
})

export const extensionInvokeErrorSchema = Schema.Struct({
  code: extensionInvokeFailureCodeSchema,
  message: nonEmptyStringSchema,
  issues: Schema.optional(Schema.Array(nonEmptyStringSchema)),
})

export const extensionHostContextResultSchema = Schema.Struct({
  extensionId: extensionIdSchema,
  contributionId: extensionContributionIdSchema,
  capability: Schema.Literal(OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.HOST_CONTEXT),
  method: Schema.Literal(OPENWAGGLE_EXTENSION_BROKER.METHOD.GET_SCOPE),
  scope: extensionInvokeScopeSchema,
  declaredScopes: Schema.Array(Schema.Literal(...OPENWAGGLE_EXTENSION.CAPABILITY_SCOPES)),
})

export const extensionInvokeSuccessSchema = Schema.Struct({
  ok: Schema.Literal(true),
  value: extensionHostContextResultSchema,
  audit: extensionCapabilityAuditEntrySchema,
})

export const extensionInvokeFailureSchema = Schema.Struct({
  ok: Schema.Literal(false),
  error: extensionInvokeErrorSchema,
  audit: Schema.optional(extensionCapabilityAuditEntrySchema),
})

export const extensionInvokeResultSchema = Schema.Union(
  extensionInvokeSuccessSchema,
  extensionInvokeFailureSchema,
)

export type ExtensionInvokeScope = SchemaType<typeof extensionInvokeScopeSchema>
export type ExtensionInvokeInput = SchemaType<typeof extensionInvokeInputSchema>
export type ExtensionInvokeFailureCode = SchemaType<typeof extensionInvokeFailureCodeSchema>
export type ExtensionInvokeOutcome = SchemaType<typeof extensionInvokeOutcomeSchema>
export type ExtensionCapabilityAuditEntry = SchemaType<typeof extensionCapabilityAuditEntrySchema>
export type ExtensionInvokeError = SchemaType<typeof extensionInvokeErrorSchema>
export type ExtensionHostContextResult = SchemaType<typeof extensionHostContextResultSchema>
export type ExtensionInvokeSuccess = SchemaType<typeof extensionInvokeSuccessSchema>
export type ExtensionInvokeFailure = SchemaType<typeof extensionInvokeFailureSchema>
export type ExtensionInvokeResult = SchemaType<typeof extensionInvokeResultSchema>
