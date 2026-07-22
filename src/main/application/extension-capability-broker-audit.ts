import { OPENWAGGLE_EXTENSION_BROKER } from '@shared/constants/extension-broker'
import type {
  ExtensionCapabilityAuditEntry,
  ExtensionInvokeFailureCode,
  ExtensionInvokeInput,
  ExtensionInvokeResult,
  ExtensionInvokeSuccessValue,
} from '@shared/types/extension-broker'
import * as Effect from 'effect/Effect'
import { AppLogger } from '../services/logger-service'
import { makeCapabilityAudit } from './extension-capability-broker-model'

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

export function auditedSuccess(input: {
  readonly invocation: ExtensionInvokeInput
  readonly value: ExtensionInvokeSuccessValue
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
