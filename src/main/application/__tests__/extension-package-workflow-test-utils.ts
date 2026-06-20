import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import type { DiscoveredExtensionPackage, ExtensionLifecycleState } from '../../extensions/types'
import { ExtensionLifecycleRepository } from '../../ports/extension-lifecycle-repository'
import { ExtensionManagerService } from '../../ports/extension-manager-service'
import { ExtensionPackageRepository } from '../../ports/extension-package-repository'
import { ExtensionProjectOverridesRepository } from '../../ports/extension-project-overrides-repository'
import {
  EXTENSION_PACKAGE_WORKFLOW,
  type ExtensionPackageRemoveWorkflowInput,
  type ExtensionPackageWorkflowActor,
  type ExtensionPackageWorkflowGlobalConfirmation,
  type ExtensionPackageWorkflowUserApproval,
  type ExtensionPackageWriteWorkflowInput,
  getExtensionPackageRemoveProposalHash,
  getExtensionPackageWriteProposalHash,
} from '../extension-package-workflow-model'
import { PROJECT_PATH } from './extension-contribution-registry-test-utils'
import { TrustedMainActivationDependenciesTestLayer } from './extension-trusted-main-activation-test-layer'

export const AGENT_ACTOR = {
  kind: 'agent',
  agentId: 'agent-1',
  sessionId: 'session-1',
} satisfies ExtensionPackageWorkflowActor

export const PROJECT_SCOPE = {
  kind: OPENWAGGLE_EXTENSION.SCOPE.PROJECT_KIND,
  projectPath: PROJECT_PATH,
} as const

export const GLOBAL_SCOPE = {
  kind: OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND,
} as const

function scopesMatch(
  left: DiscoveredExtensionPackage['scope'],
  right: DiscoveredExtensionPackage['scope'],
) {
  if (left.kind !== right.kind) {
    return false
  }
  if (left.kind === OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND) {
    return true
  }
  return (
    right.kind === OPENWAGGLE_EXTENSION.SCOPE.PROJECT_KIND && left.projectPath === right.projectPath
  )
}

export function packageFiles(extensionId: string) {
  return [
    {
      relativePath: OPENWAGGLE_EXTENSION.MANIFEST_FILE,
      content: `${JSON.stringify({
        manifestVersion: 1,
        id: extensionId,
        name: 'Workflow Extension',
        version: '1.0.0',
        sdk: { openwaggle: '>=0.1.0 <0.2.0' },
        sourceFiles: ['src/index.ts'],
        builtArtifacts: ['dist/index.js'],
      })}\n`,
    },
    {
      relativePath: 'src/index.ts',
      content: 'export const source = true\n',
    },
    {
      relativePath: 'dist/index.js',
      content: 'export const built = true\n',
    },
  ]
}

function approvedUserApproval(proposalHash: string): ExtensionPackageWorkflowUserApproval {
  return {
    approved: true,
    approvedProposalHash: proposalHash,
    approvedBy: 'User',
    approvedAt: 1000,
  }
}

function globalConfirmation(input: {
  readonly extensionId: string
  readonly proposalHash: string
}): ExtensionPackageWorkflowGlobalConfirmation {
  return {
    confirmed: true,
    confirmedExtensionId: input.extensionId,
    confirmedProposalHash: input.proposalHash,
    risk: EXTENSION_PACKAGE_WORKFLOW.GLOBAL_CONFIRMATION_RISK,
  }
}

export function approvedWriteInput(
  input: Omit<ExtensionPackageWriteWorkflowInput, 'userApproval' | 'globalConfirmation'> & {
    readonly includeGlobalConfirmation?: boolean
  },
): ExtensionPackageWriteWorkflowInput {
  const proposalHash = getExtensionPackageWriteProposalHash(input)
  return {
    ...input,
    userApproval: approvedUserApproval(proposalHash),
    ...(input.includeGlobalConfirmation
      ? { globalConfirmation: globalConfirmation({ extensionId: input.extensionId, proposalHash }) }
      : {}),
  }
}

export function approvedRemoveInput(
  input: Omit<ExtensionPackageRemoveWorkflowInput, 'userApproval' | 'globalConfirmation'> & {
    readonly includeGlobalConfirmation?: boolean
  },
): ExtensionPackageRemoveWorkflowInput {
  const proposalHash = getExtensionPackageRemoveProposalHash(input)
  return {
    ...input,
    userApproval: approvedUserApproval(proposalHash),
    ...(input.includeGlobalConfirmation
      ? { globalConfirmation: globalConfirmation({ extensionId: input.extensionId, proposalHash }) }
      : {}),
  }
}

export function makeWorkflowHarness(input: {
  readonly packages: readonly DiscoveredExtensionPackage[]
  readonly lifecycle: ExtensionLifecycleState | null
  readonly onWritePackage?: () => void
  readonly packageAfterWrite?: DiscoveredExtensionPackage
}) {
  let storedPackages = [...input.packages]
  let storedLifecycle = input.lifecycle
  const writes: ExtensionPackageWriteWorkflowInput[] = []
  const removes: ExtensionPackageRemoveWorkflowInput[] = []

  const layer = Layer.mergeAll(
    Layer.succeed(ExtensionManagerService, {
      listPackages: () => Effect.sync(() => storedPackages),
    }),
    Layer.succeed(ExtensionLifecycleRepository, {
      get: (key) =>
        Effect.sync(() =>
          storedLifecycle?.extensionId === key.extensionId &&
          scopesMatch(storedLifecycle.scope, key.scope)
            ? storedLifecycle
            : null,
        ),
      list: (scope) =>
        Effect.sync(() =>
          storedLifecycle && scopesMatch(storedLifecycle.scope, scope) ? [storedLifecycle] : [],
        ),
      upsert: (state) =>
        Effect.sync(() => {
          storedLifecycle = state
        }),
      delete: () =>
        Effect.sync(() => {
          storedLifecycle = null
        }),
    }),
    Layer.succeed(ExtensionProjectOverridesRepository, {
      get: () => Effect.succeed(null),
      upsert: () => Effect.void,
    }),
    Layer.succeed(ExtensionPackageRepository, {
      writePackage: (writeInput) =>
        Effect.sync(() => {
          input.onWritePackage?.()
          writes.push({
            ...writeInput,
            actor: AGENT_ACTOR,
            userApproval: approvedUserApproval('recorded'),
          })
          const packageAfterWrite = input.packageAfterWrite
          if (packageAfterWrite) {
            storedPackages = [
              ...storedPackages.filter(
                (extensionPackage) =>
                  extensionPackage.id !== packageAfterWrite.id ||
                  !scopesMatch(extensionPackage.scope, packageAfterWrite.scope),
              ),
              packageAfterWrite,
            ]
          }
          return {
            packagePath: input.packageAfterWrite?.packagePath ?? '/tmp/package',
            manifestPath: input.packageAfterWrite?.manifestPath ?? '/tmp/package/manifest.json',
            mode: writeInput.mode,
          }
        }),
      removePackage: (removeInput) =>
        Effect.sync(() => {
          removes.push({
            ...removeInput,
            actor: AGENT_ACTOR,
            userApproval: approvedUserApproval('recorded'),
          })
          storedPackages = storedPackages.filter(
            (extensionPackage) =>
              extensionPackage.id !== removeInput.extensionId ||
              !scopesMatch(extensionPackage.scope, removeInput.scope),
          )
          return { packagePath: '/tmp/package', removed: true }
        }),
    }),
    TrustedMainActivationDependenciesTestLayer,
  )

  return {
    layer,
    getStoredLifecycle: () => storedLifecycle,
    getWrites: () => writes,
    getRemoves: () => removes,
  }
}
