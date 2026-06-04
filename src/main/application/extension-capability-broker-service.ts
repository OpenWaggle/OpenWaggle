import { OPENWAGGLE_EXTENSION_BROKER } from '@shared/constants/extension-broker'
import { SessionBranchId, SessionId } from '@shared/types/brand'
import type { ExtensionInvokeInput, ExtensionInvokeScope } from '@shared/types/extension-broker'
import * as Effect from 'effect/Effect'
import { isExtensionRuntimeEnabled } from '../extensions/runtime-eligibility'
import type { DiscoveredExtensionPackage } from '../extensions/types'
import { ExtensionLifecycleRepository } from '../ports/extension-lifecycle-repository'
import { ExtensionManagerService } from '../ports/extension-manager-service'
import { ExtensionProjectOverridesRepository } from '../ports/extension-project-overrides-repository'
import { SessionProjectionRepository } from '../ports/session-projection-repository'
import { SessionRepository } from '../ports/session-repository'
import { auditedFailure } from './extension-capability-broker-audit'
import {
  contributionMethodIsDeclared,
  entryMatchesPackage,
  getCapabilityDeclaration,
  getDeclaredScopes,
  getScopeProjectPath,
  methodIsDeclared,
  normalizeInput,
  pickInvocationPackage,
} from './extension-capability-broker-model'
import { routeAuthorizedInvocation } from './extension-capability-broker-results'
import { listExtensionContributionRegistryView } from './extension-contribution-registry-service'

export interface InvokeExtensionCapabilityDependencies {
  readonly now?: () => number
}

type ScopeResolution =
  | { readonly _tag: 'ok' }
  | { readonly _tag: 'failure'; readonly message: string }

function scopeOk(): ScopeResolution {
  return { _tag: 'ok' }
}

function scopeFailure(message: string): ScopeResolution {
  return { _tag: 'failure', message }
}

function currentTimestamp(dependencies: InvokeExtensionCapabilityDependencies) {
  return dependencies.now?.() ?? Date.now()
}

function resolveScopeContext(scope: ExtensionInvokeScope) {
  return Effect.gen(function* () {
    if (scope.kind === 'app' || scope.kind === 'project') {
      return scopeOk()
    }

    if (scope.kind === 'session') {
      const sessions = yield* SessionProjectionRepository
      const session = yield* sessions.getOptional(SessionId(scope.sessionId))
      if (!session) {
        return scopeFailure(`Session "${scope.sessionId}" is not in scope.`)
      }
      if (session.projectPath !== scope.projectPath) {
        return scopeFailure(`Session "${scope.sessionId}" is outside project scope.`)
      }
      return scopeOk()
    }

    const sessions = yield* SessionRepository
    const tree = yield* sessions.getTree(SessionId(scope.sessionId))
    if (!tree) {
      return scopeFailure(`Session "${scope.sessionId}" is not in scope.`)
    }
    if (tree.session.projectPath !== scope.projectPath) {
      return scopeFailure(`Session "${scope.sessionId}" is outside project scope.`)
    }
    const branchId = SessionBranchId(scope.branchId)
    const branch = tree.branches.find((candidate) => candidate.id === branchId)
    if (!branch) {
      return scopeFailure(`Branch "${scope.branchId}" is not in scope.`)
    }
    return scopeOk()
  })
}

function loadInvocationPackage(extensionId: string, projectPath: string | undefined) {
  return Effect.gen(function* () {
    const manager = yield* ExtensionManagerService
    const packages = yield* manager.listPackages({ projectPath: projectPath ?? null })
    const candidates = packages.filter((extensionPackage) => extensionPackage.id === extensionId)
    return pickInvocationPackage(candidates, projectPath)
  })
}

function isPackageRuntimeEnabled(
  extensionPackage: DiscoveredExtensionPackage,
  projectPath: string | undefined,
) {
  return Effect.gen(function* () {
    const lifecycleRepository = yield* ExtensionLifecycleRepository
    const projectOverridesRepository = yield* ExtensionProjectOverridesRepository
    const lifecycle = yield* lifecycleRepository.get({
      extensionId: extensionPackage.id,
      scope: extensionPackage.scope,
    })
    const projectOverride = projectPath
      ? yield* projectOverridesRepository.get({
          extensionId: extensionPackage.id,
          scope: extensionPackage.scope,
          projectPath,
        })
      : null

    return isExtensionRuntimeEnabled({ extensionPackage, lifecycle, projectOverride })
  })
}

function findContributionEntry(input: {
  readonly extensionPackage: DiscoveredExtensionPackage
  readonly invocation: ExtensionInvokeInput
  readonly projectPath: string | undefined
}) {
  return Effect.gen(function* () {
    const registry = yield* listExtensionContributionRegistryView({
      projectPaths: input.projectPath ? [input.projectPath] : [],
    })
    return (
      registry.entries.find(
        (entry) =>
          entry.extensionId === input.invocation.extensionId &&
          entry.contributionId === input.invocation.contributionId &&
          entryMatchesPackage(entry, input.extensionPackage),
      ) ?? null
    )
  })
}

export function invokeExtensionCapability(
  rawInput: ExtensionInvokeInput,
  dependencies: InvokeExtensionCapabilityDependencies = {},
) {
  return Effect.gen(function* () {
    const input = normalizeInput(rawInput)
    const timestamp = currentTimestamp(dependencies)
    const projectPath = getScopeProjectPath(input.scope)
    const scopeResolution = yield* resolveScopeContext(input.scope)
    if (scopeResolution._tag === 'failure') {
      return yield* auditedFailure({
        invocation: input,
        code: OPENWAGGLE_EXTENSION_BROKER.FAILURE_CODE.OUT_OF_SCOPE,
        message: scopeResolution.message,
        timestamp,
      })
    }

    const extensionPackage = yield* loadInvocationPackage(input.extensionId, projectPath)
    if (!extensionPackage) {
      return yield* auditedFailure({
        invocation: input,
        code: OPENWAGGLE_EXTENSION_BROKER.FAILURE_CODE.UNKNOWN_EXTENSION,
        message: `Extension "${input.extensionId}" was not found for the invocation scope.`,
        timestamp,
      })
    }

    const runtimeEnabled = yield* isPackageRuntimeEnabled(extensionPackage, projectPath)
    if (!runtimeEnabled) {
      return yield* auditedFailure({
        invocation: input,
        code: OPENWAGGLE_EXTENSION_BROKER.FAILURE_CODE.DISABLED_EXTENSION,
        message: `Extension "${input.extensionId}" is not enabled for the invocation scope.`,
        timestamp,
      })
    }

    const entry = yield* findContributionEntry({ extensionPackage, invocation: input, projectPath })
    if (!entry) {
      return yield* auditedFailure({
        invocation: input,
        code: OPENWAGGLE_EXTENSION_BROKER.FAILURE_CODE.UNKNOWN_CONTRIBUTION,
        message: `Contribution "${input.contributionId}" was not found for extension "${input.extensionId}".`,
        timestamp,
      })
    }

    if (projectPath && !entry.projectPaths.includes(projectPath)) {
      return yield* auditedFailure({
        invocation: input,
        code: OPENWAGGLE_EXTENSION_BROKER.FAILURE_CODE.OUT_OF_SCOPE,
        message: `Contribution "${input.contributionId}" is outside project scope.`,
        timestamp,
      })
    }

    const declaration = getCapabilityDeclaration({
      extensionPackage,
      capability: input.capability,
    })
    if (!declaration || entry.capability !== input.capability) {
      return yield* auditedFailure({
        invocation: input,
        code: OPENWAGGLE_EXTENSION_BROKER.FAILURE_CODE.UNDECLARED_CAPABILITY,
        message: `Capability "${input.capability}" is not declared for contribution "${input.contributionId}".`,
        timestamp,
      })
    }

    if (
      !contributionMethodIsDeclared(entry, input.method) ||
      !methodIsDeclared(declaration, input.method)
    ) {
      return yield* auditedFailure({
        invocation: input,
        code: OPENWAGGLE_EXTENSION_BROKER.FAILURE_CODE.UNDECLARED_METHOD,
        message: `Method "${input.method}" is not declared for capability "${input.capability}".`,
        timestamp,
      })
    }

    const declaredScopes = getDeclaredScopes(declaration)
    if (!declaredScopes.includes(input.scope.kind)) {
      return yield* auditedFailure({
        invocation: input,
        code: OPENWAGGLE_EXTENSION_BROKER.FAILURE_CODE.UNDECLARED_SCOPE,
        message: `Scope "${input.scope.kind}" is not declared for capability "${input.capability}".`,
        timestamp,
      })
    }

    return yield* routeAuthorizedInvocation({
      invocation: input,
      packageScope: extensionPackage.scope,
      declaredScopes,
      timestamp,
    })
  })
}
