import { OPENWAGGLE_EXTENSION_BROKER } from '@shared/constants/extension-broker'
import type { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import type {
  ExtensionCapabilityAuditEntry,
  ExtensionHostContextResult,
  ExtensionInvokeFailureCode,
  ExtensionInvokeInput,
  ExtensionInvokeResult,
} from '@shared/types/extension-broker'
import * as Effect from 'effect/Effect'
import { AppLogger } from '../services/logger-service'
import { hostContextPayloadIsValid, makeCapabilityAudit } from './extension-capability-broker-model'

function logAudit(audit: ExtensionCapabilityAuditEntry) {
  return Effect.gen(function* () {
    const logger = yield* AppLogger
    const data: Readonly<Record<string, unknown>> = {
      extensionId: audit.extensionId,
      contributionId: audit.contributionId,
      capability: audit.capability,
      method: audit.method,
      scope: audit.scope,
      outcome: audit.outcome,
      timestamp: audit.timestamp,
      ...(audit.failureCode !== undefined ? { failureCode: audit.failureCode } : {}),
    }
    yield* logger.info('extension-broker', 'Extension capability call audited', data)
  })
}

export function auditedFailure(input: {
  readonly invocation: ExtensionInvokeInput
  readonly code: ExtensionInvokeFailureCode
  readonly message: string
  readonly timestamp: number
  readonly issues?: readonly string[]
}) {
  const audit = makeCapabilityAudit({
    invocation: input.invocation,
    outcome: OPENWAGGLE_EXTENSION_BROKER.OUTCOME.REJECTED,
    timestamp: input.timestamp,
    failureCode: input.code,
  })
  const result: ExtensionInvokeResult = {
    ok: false,
    error: {
      code: input.code,
      message: input.message,
      ...(input.issues !== undefined ? { issues: input.issues } : {}),
    },
    audit,
  }

  return logAudit(audit).pipe(Effect.as(result))
}

function auditedSuccess(input: {
  readonly invocation: ExtensionInvokeInput
  readonly value: ExtensionHostContextResult
  readonly timestamp: number
}) {
  const audit = makeCapabilityAudit({
    invocation: input.invocation,
    outcome: OPENWAGGLE_EXTENSION_BROKER.OUTCOME.SUCCEEDED,
    timestamp: input.timestamp,
  })
  const result: ExtensionInvokeResult = {
    ok: true,
    value: input.value,
    audit,
  }

  return logAudit(audit).pipe(Effect.as(result))
}

export function routeAuthorizedInvocation(input: {
  readonly invocation: ExtensionInvokeInput
  readonly declaredScopes: readonly (typeof OPENWAGGLE_EXTENSION.CAPABILITY_SCOPES)[number][]
  readonly timestamp: number
}) {
  if (input.invocation.capability !== OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.HOST_CONTEXT) {
    return auditedFailure({
      invocation: input.invocation,
      code: OPENWAGGLE_EXTENSION_BROKER.FAILURE_CODE.UNSUPPORTED_CAPABILITY,
      message: `Capability "${input.invocation.capability}" is not implemented by the broker foundation.`,
      timestamp: input.timestamp,
    })
  }

  if (input.invocation.method !== OPENWAGGLE_EXTENSION_BROKER.METHOD.GET_SCOPE) {
    return auditedFailure({
      invocation: input.invocation,
      code: OPENWAGGLE_EXTENSION_BROKER.FAILURE_CODE.UNSUPPORTED_METHOD,
      message: `Method "${input.invocation.method}" is not implemented for capability "${input.invocation.capability}".`,
      timestamp: input.timestamp,
    })
  }

  if (!hostContextPayloadIsValid(input.invocation.payload)) {
    return auditedFailure({
      invocation: input.invocation,
      code: OPENWAGGLE_EXTENSION_BROKER.FAILURE_CODE.INVALID_PAYLOAD,
      message: 'The host context capability expects an empty object payload.',
      timestamp: input.timestamp,
    })
  }

  return auditedSuccess({
    invocation: input.invocation,
    timestamp: input.timestamp,
    value: {
      extensionId: input.invocation.extensionId,
      contributionId: input.invocation.contributionId,
      capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.HOST_CONTEXT,
      method: OPENWAGGLE_EXTENSION_BROKER.METHOD.GET_SCOPE,
      scope: input.invocation.scope,
      declaredScopes: input.declaredScopes,
    },
  })
}
