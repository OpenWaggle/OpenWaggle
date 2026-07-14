import * as Schema from 'effect/Schema'
import { OPENWAGGLE_EXTENSION_BROKER } from './constants.js'
import { extensionContributionIdSchema, extensionIdSchema } from './manifest.js'
import { createOpenWaggleSdk } from './openwaggle-sdk.js'
import { createRuntimeContributionSdk } from './runtime-sdk.js'
import type {
  CreateOpenWaggleSdkOptions,
  ExtensionBrokerSdk,
  ExtensionBrokerTransport,
  ExtensionSdkIdentity,
  ExtensionSdkInvoke,
  ExtensionSdkInvokeRequest,
} from './sdk-types.js'
import { createPackageStorageSdk } from './storage-sdk.js'
import type { ExtensionInvokeInput } from './types.js'

export type * from './core-types.js'
export type * from './sdk-types.js'

const nonEmptyStringSchema = Schema.String.pipe(Schema.minLength(1))

export const extensionInvokeScopeSchema = Schema.Union(
  Schema.Struct({ kind: Schema.Literal('app') }),
  Schema.Struct({ kind: Schema.Literal('project'), projectPath: nonEmptyStringSchema }),
  Schema.Struct({
    kind: Schema.Literal('session'),
    projectPath: nonEmptyStringSchema,
    sessionId: nonEmptyStringSchema,
  }),
  Schema.Struct({
    kind: Schema.Literal('branch'),
    projectPath: nonEmptyStringSchema,
    sessionId: nonEmptyStringSchema,
    branchId: nonEmptyStringSchema,
  }),
)

export const extensionCapabilityAuditEntrySchema = Schema.Struct({
  extensionId: extensionIdSchema,
  contributionId: extensionContributionIdSchema,
  capability: extensionContributionIdSchema,
  method: extensionContributionIdSchema,
  scope: extensionInvokeScopeSchema,
  outcome: Schema.Literal(...OPENWAGGLE_EXTENSION_BROKER.OUTCOMES),
  timestamp: Schema.Number,
  failureCode: Schema.optional(Schema.Literal(...OPENWAGGLE_EXTENSION_BROKER.FAILURE_CODES)),
})

export const extensionInvokeInputSchema = Schema.Struct({
  extensionId: extensionIdSchema,
  contributionId: extensionContributionIdSchema,
  capability: extensionContributionIdSchema,
  method: extensionContributionIdSchema,
  scope: extensionInvokeScopeSchema,
  payload: Schema.optional(Schema.Unknown),
})

export const extensionInvokeErrorSchema = Schema.Struct({
  code: Schema.Literal(...OPENWAGGLE_EXTENSION_BROKER.FAILURE_CODES),
  message: nonEmptyStringSchema,
  issues: Schema.optional(Schema.Array(Schema.String)),
})

export const extensionInvokeSuccessSchema = Schema.Struct({
  ok: Schema.Literal(true),
  value: Schema.Unknown,
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

export function toInvokeInput(
  identity: ExtensionSdkIdentity,
  request: ExtensionSdkInvokeRequest,
): ExtensionInvokeInput {
  return {
    extensionId: identity.extensionId,
    contributionId: identity.contributionId,
    capability: request.capability,
    method: request.method,
    scope: request.scope,
    ...(request.payload !== undefined ? { payload: request.payload } : {}),
  }
}

export function createExtensionBrokerSdkFromInvoke(
  invoke: ExtensionSdkInvoke,
  options: CreateOpenWaggleSdkOptions = {},
): ExtensionBrokerSdk {
  return {
    invoke,
    hostContext: {
      getScope: (scope) =>
        invoke({
          capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.HOST_CONTEXT,
          method: OPENWAGGLE_EXTENSION_BROKER.METHOD.GET_SCOPE,
          scope,
          payload: {},
        }),
    },
    storage: createPackageStorageSdk(invoke),
    openWaggle: createOpenWaggleSdk(invoke, options),
    runtime: createRuntimeContributionSdk(invoke),
  }
}

export function createExtensionBrokerSdk(
  transport: ExtensionBrokerTransport,
  identity: ExtensionSdkIdentity,
  options: CreateOpenWaggleSdkOptions = {},
): ExtensionBrokerSdk {
  const invoke: ExtensionSdkInvoke = (request) => transport(toInvokeInput(identity, request))

  return createExtensionBrokerSdkFromInvoke(invoke, options)
}
