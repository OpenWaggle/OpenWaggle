import * as Schema from 'effect/Schema'
import { OPENWAGGLE_EXTENSION, OPENWAGGLE_EXTENSION_BROKER } from './constants.js'
import { extensionContributionIdSchema, extensionIdSchema } from './manifest.js'

const EXTENSION_INVOCATION_BINDING_MAX_LENGTH = 128

/** A string with at least one character that is not whitespace. */
export const nonEmptyStringSchema = Schema.String.pipe(
  Schema.filter((value) => value.trim().length > 0 || 'Must not be empty.'),
)

export const extensionInvokeAppScopeSchema = Schema.Struct({ kind: Schema.Literal('app') })

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

export const extensionInvocationBindingSchema = Schema.String.pipe(
  Schema.minLength(1),
  Schema.maxLength(EXTENSION_INVOCATION_BINDING_MAX_LENGTH),
)

export const extensionInvokeFailureCodeSchema = Schema.Literal(
  ...OPENWAGGLE_EXTENSION_BROKER.FAILURE_CODES,
)
export const extensionInvokeOutcomeSchema = Schema.Literal(...OPENWAGGLE_EXTENSION_BROKER.OUTCOMES)
export const extensionBrokerMethodSchema = Schema.Literal(...OPENWAGGLE_EXTENSION_BROKER.METHODS)

export const extensionCapabilityAuditEntrySchema = Schema.Struct({
  extensionId: extensionIdSchema,
  contributionId: extensionContributionIdSchema,
  capability: extensionContributionIdSchema,
  method: extensionContributionIdSchema,
  scope: extensionInvokeScopeSchema,
  outcome: extensionInvokeOutcomeSchema,
  timestamp: Schema.Number,
  // Exact like the extension SDK's ExtensionCapabilityAuditEntry: the broker omits the key.
  failureCode: Schema.optionalWith(extensionInvokeFailureCodeSchema, { exact: true }),
})

export const extensionInvokeErrorSchema = Schema.Struct({
  code: extensionInvokeFailureCodeSchema,
  message: nonEmptyStringSchema,
  issues: Schema.optionalWith(Schema.Array(nonEmptyStringSchema), { exact: true }),
})

export const extensionHostContextResultSchema = Schema.Struct({
  extensionId: extensionIdSchema,
  contributionId: extensionContributionIdSchema,
  capability: Schema.Literal(OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.HOST_CONTEXT),
  method: Schema.Literal(OPENWAGGLE_EXTENSION_BROKER.METHOD.GET_SCOPE),
  scope: extensionInvokeScopeSchema,
  declaredScopes: Schema.Array(Schema.Literal(...OPENWAGGLE_EXTENSION.CAPABILITY_SCOPES)),
})
