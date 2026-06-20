import { matchBy } from '@diegogbrisa/ts-match'
import { OPENWAGGLE_EXTENSION_BROKER } from '@shared/constants/extension-broker'
import { safeDecodeUnknown } from '@shared/schema'
import {
  extensionRuntimeRegisterContributionPayloadSchema,
  extensionRuntimeUnregisterContributionPayloadSchema,
} from '@shared/schemas/extension-broker'
import type {
  ExtensionInvokeInput,
  ExtensionInvokeScope,
  ExtensionRuntimeRegisterContributionPayload,
} from '@shared/types/extension-broker'
import type { DiscoveredExtensionPackage, ExtensionDiagnostic } from '../extensions/types'
import { auditedFailure, auditedSuccess } from './extension-capability-broker-audit'
import type { ContributionRegistrationEntry } from './extension-contribution-registration-model'
import {
  registerRuntimePackageContribution,
  unregisterRuntimePackageContribution,
} from './extension-contribution-registry-cache'
import {
  authorizeRuntimeContributionRegistration,
  authorizeRuntimeContributionUnregistration,
} from './extension-runtime-contribution-authorization-model'

type RuntimeContribution = ExtensionRuntimeRegisterContributionPayload['contribution']

type ScopedContributionResult =
  | {
      readonly _tag: 'ok'
      readonly contribution: RuntimeContribution
    }
  | {
      readonly _tag: 'rejected'
      readonly issues: readonly string[]
    }

type ScopedRegistrationResult =
  | {
      readonly _tag: 'ok'
      readonly registration: ExtensionRuntimeRegisterContributionPayload
    }
  | {
      readonly _tag: 'rejected'
      readonly issues: readonly string[]
    }

function diagnosticIssues(diagnostics: readonly ExtensionDiagnostic[]) {
  return diagnostics.map((diagnostic) => diagnostic.message)
}

function uniqueTrimmedValues(values: readonly string[]) {
  const normalized: string[] = []
  for (const value of values) {
    const trimmed = value.trim()
    if (trimmed.length > 0 && !normalized.includes(trimmed)) {
      normalized.push(trimmed)
    }
  }
  return normalized
}

function scopeProjectPath(scope: ExtensionInvokeScope) {
  return matchBy(scope, 'kind')
    .with('app', () => undefined)
    .with('project', 'session', 'branch', (projectScope) => projectScope.projectPath)
    .exhaustive()
}

function scopeSessionId(scope: ExtensionInvokeScope) {
  return matchBy(scope, 'kind')
    .with('app', 'project', () => undefined)
    .with('session', 'branch', (sessionScope) => sessionScope.sessionId)
    .exhaustive()
}

function targetValuesStayWithinScope(values: readonly string[] | undefined, requiredValue: string) {
  if (values === undefined) {
    return true
  }

  const normalizedValues = uniqueTrimmedValues(values)
  return normalizedValues.length > 0 && normalizedValues.every((value) => value === requiredValue)
}

function scopeContributionTarget(input: {
  readonly scope: ExtensionInvokeScope
  readonly contribution: RuntimeContribution
}): ScopedContributionResult {
  const projectPath = scopeProjectPath(input.scope)
  const sessionId = scopeSessionId(input.scope)
  if (input.scope.kind === 'branch') {
    return {
      _tag: 'rejected',
      issues: [
        'Branch-scoped runtime contribution registration is not supported until contribution targets can persist branch scope.',
      ],
    }
  }

  if (projectPath === undefined && sessionId === undefined) {
    return {
      _tag: 'ok',
      contribution: input.contribution,
    }
  }

  const issues: string[] = []
  if (!targetValuesStayWithinScope(input.contribution.target?.projectPaths, projectPath ?? '')) {
    issues.push('Runtime contribution target is outside the invocation project scope.')
  }
  if (
    sessionId !== undefined &&
    !targetValuesStayWithinScope(input.contribution.target?.sessionIds, sessionId)
  ) {
    issues.push('Runtime contribution target is outside the invocation session scope.')
  }
  if (issues.length > 0) {
    return { _tag: 'rejected', issues }
  }

  return {
    _tag: 'ok',
    contribution: {
      ...input.contribution,
      target: {
        ...(input.contribution.target ?? {}),
        ...(projectPath !== undefined ? { projectPaths: [projectPath] } : {}),
        ...(sessionId !== undefined ? { sessionIds: [sessionId] } : {}),
      },
    },
  }
}

function scopedRuntimeContributionRegistration(input: {
  readonly scope: ExtensionInvokeScope
  readonly registration: ExtensionRuntimeRegisterContributionPayload
}): ScopedRegistrationResult {
  const scopedContribution = scopeContributionTarget({
    scope: input.scope,
    contribution: input.registration.contribution,
  })
  if (scopedContribution._tag === 'rejected') {
    return scopedContribution
  }

  const decoded = safeDecodeUnknown(extensionRuntimeRegisterContributionPayloadSchema, {
    family: input.registration.family,
    contribution: scopedContribution.contribution,
  })

  return decoded.success
    ? { _tag: 'ok', registration: decoded.data }
    : { _tag: 'rejected', issues: decoded.issues }
}

function registrationEntry(
  registration: ExtensionRuntimeRegisterContributionPayload,
): ContributionRegistrationEntry {
  return {
    family: registration.family,
    contribution: registration.contribution,
  }
}

function routeRuntimeContributionRegistration(input: {
  readonly invocation: ExtensionInvokeInput
  readonly extensionPackage: DiscoveredExtensionPackage
  readonly timestamp: number
}) {
  const decoded = safeDecodeUnknown(
    extensionRuntimeRegisterContributionPayloadSchema,
    input.invocation.payload,
  )
  if (!decoded.success) {
    return auditedFailure({
      invocation: input.invocation,
      code: OPENWAGGLE_EXTENSION_BROKER.FAILURE_CODE.INVALID_PAYLOAD,
      message: 'Invalid runtime contribution registration payload.',
      timestamp: input.timestamp,
      issues: decoded.issues,
    })
  }

  const scopedRegistration = scopedRuntimeContributionRegistration({
    scope: input.invocation.scope,
    registration: decoded.data,
  })
  if (scopedRegistration._tag === 'rejected') {
    return auditedFailure({
      invocation: input.invocation,
      code: OPENWAGGLE_EXTENSION_BROKER.FAILURE_CODE.INVALID_PAYLOAD,
      message: 'Runtime contribution registration is outside the invocation scope.',
      timestamp: input.timestamp,
      issues: scopedRegistration.issues,
    })
  }

  const authorization = authorizeRuntimeContributionRegistration({
    extensionPackage: input.extensionPackage,
    registration: scopedRegistration.registration,
  })
  if (authorization._tag === 'rejected') {
    return auditedFailure({
      invocation: input.invocation,
      code: OPENWAGGLE_EXTENSION_BROKER.FAILURE_CODE.INVALID_PAYLOAD,
      message: 'Runtime contribution registration is not authorized.',
      timestamp: input.timestamp,
      issues: diagnosticIssues(authorization.diagnostics),
    })
  }

  registerRuntimePackageContribution({
    extensionPackage: input.extensionPackage,
    registration: registrationEntry(scopedRegistration.registration),
  })

  return auditedSuccess({
    invocation: input.invocation,
    timestamp: input.timestamp,
    value: {
      extensionId: input.invocation.extensionId,
      contributionId: input.invocation.contributionId,
      capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.RUNTIME,
      method: OPENWAGGLE_EXTENSION_BROKER.METHOD.REGISTER_CONTRIBUTION,
      family: scopedRegistration.registration.family,
      registeredContributionId: scopedRegistration.registration.contribution.id,
    },
  })
}

function routeRuntimeContributionUnregistration(input: {
  readonly invocation: ExtensionInvokeInput
  readonly extensionPackage: DiscoveredExtensionPackage
  readonly timestamp: number
}) {
  if (input.invocation.scope.kind === 'branch') {
    return auditedFailure({
      invocation: input.invocation,
      code: OPENWAGGLE_EXTENSION_BROKER.FAILURE_CODE.INVALID_PAYLOAD,
      message: 'Runtime contribution unregistration is outside the supported invocation scope.',
      timestamp: input.timestamp,
      issues: [
        'Branch-scoped runtime contribution unregistration is not supported until contribution targets can persist branch scope.',
      ],
    })
  }

  const decoded = safeDecodeUnknown(
    extensionRuntimeUnregisterContributionPayloadSchema,
    input.invocation.payload,
  )
  if (!decoded.success) {
    return auditedFailure({
      invocation: input.invocation,
      code: OPENWAGGLE_EXTENSION_BROKER.FAILURE_CODE.INVALID_PAYLOAD,
      message: 'Invalid runtime contribution unregistration payload.',
      timestamp: input.timestamp,
      issues: decoded.issues,
    })
  }

  const authorization = authorizeRuntimeContributionUnregistration({
    extensionPackage: input.extensionPackage,
    unregistration: decoded.data,
  })
  if (authorization._tag === 'rejected') {
    return auditedFailure({
      invocation: input.invocation,
      code: OPENWAGGLE_EXTENSION_BROKER.FAILURE_CODE.INVALID_PAYLOAD,
      message: 'Runtime contribution unregistration is not authorized.',
      timestamp: input.timestamp,
      issues: diagnosticIssues(authorization.diagnostics),
    })
  }

  const unregistered = unregisterRuntimePackageContribution({
    extensionPackage: input.extensionPackage,
    family: decoded.data.family,
    contributionId: decoded.data.contributionId,
    invocationScope: input.invocation.scope,
  })

  return auditedSuccess({
    invocation: input.invocation,
    timestamp: input.timestamp,
    value: {
      extensionId: input.invocation.extensionId,
      contributionId: input.invocation.contributionId,
      capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.RUNTIME,
      method: OPENWAGGLE_EXTENSION_BROKER.METHOD.UNREGISTER_CONTRIBUTION,
      family: decoded.data.family,
      unregisteredContributionId: decoded.data.contributionId,
      unregistered,
    },
  })
}

export function routeRuntimeContributionCapability(input: {
  readonly invocation: ExtensionInvokeInput
  readonly extensionPackage: DiscoveredExtensionPackage
  readonly timestamp: number
}) {
  if (input.invocation.method === OPENWAGGLE_EXTENSION_BROKER.METHOD.REGISTER_CONTRIBUTION) {
    return routeRuntimeContributionRegistration(input)
  }

  if (input.invocation.method === OPENWAGGLE_EXTENSION_BROKER.METHOD.UNREGISTER_CONTRIBUTION) {
    return routeRuntimeContributionUnregistration(input)
  }

  return auditedFailure({
    invocation: input.invocation,
    code: OPENWAGGLE_EXTENSION_BROKER.FAILURE_CODE.UNSUPPORTED_METHOD,
    message: `Method "${input.invocation.method}" is not implemented for capability "${input.invocation.capability}".`,
    timestamp: input.timestamp,
  })
}
