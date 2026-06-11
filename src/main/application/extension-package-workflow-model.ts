import { createHash } from 'node:crypto'
import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import type { ExtensionPackageScope } from '../extensions/types'
import type {
  ExtensionPackageFileWrite,
  ExtensionPackageWriteMode,
} from '../ports/extension-package-repository'

const EXTENSION_PACKAGE_WORKFLOW_PROPOSAL_VERSION = '1'

export const EXTENSION_PACKAGE_WORKFLOW = {
  GLOBAL_CONFIRMATION_RISK: 'global-extension-package-write',
  ERROR: {
    EXTENSION_ACTOR_REJECTED:
      'Extensions cannot modify extension packages. Use the user-approved extension package workflow.',
    APPROVAL_REQUIRED: 'A user approval is required before modifying an extension package.',
    APPROVAL_HASH_MISMATCH:
      'The approved extension package proposal does not match the requested package mutation.',
    GLOBAL_CONFIRMATION_REQUIRED:
      'Global extension package changes require explicit global-impact confirmation.',
  },
} as const

export type ExtensionPackageWorkflowActor =
  | {
      readonly kind: 'agent'
      readonly agentId: string
      readonly sessionId?: string
    }
  | {
      readonly kind: 'user'
      readonly userId?: string
    }
  | {
      readonly kind: 'extension'
      readonly extensionId: string
    }

export interface ExtensionPackageWorkflowUserApproval {
  readonly approved: boolean
  readonly approvedProposalHash: string
  readonly approvedBy: string
  readonly approvedAt: number
}

export interface ExtensionPackageWorkflowGlobalConfirmation {
  readonly confirmed: boolean
  readonly confirmedExtensionId: string
  readonly confirmedProposalHash: string
  readonly risk: typeof EXTENSION_PACKAGE_WORKFLOW.GLOBAL_CONFIRMATION_RISK
}

export interface ExtensionPackageWorkflowTarget {
  readonly extensionId: string
  readonly scope: ExtensionPackageScope
  readonly actor: ExtensionPackageWorkflowActor
  readonly userApproval: ExtensionPackageWorkflowUserApproval
  readonly globalConfirmation?: ExtensionPackageWorkflowGlobalConfirmation
  readonly viewProjectPaths?: readonly string[]
}

export interface ExtensionPackageWriteWorkflowInput extends ExtensionPackageWorkflowTarget {
  readonly mode: ExtensionPackageWriteMode
  readonly files: readonly ExtensionPackageFileWrite[]
}

export type ExtensionPackageRemoveWorkflowInput = ExtensionPackageWorkflowTarget

function scopeHashSegment(scope: ExtensionPackageScope) {
  return scope.kind === OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND
    ? `${OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND}:${OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_ID}`
    : `${OPENWAGGLE_EXTENSION.SCOPE.PROJECT_KIND}:${scope.projectPath}`
}

function normalizedWorkflowFilePath(relativePath: string) {
  return relativePath.replaceAll(
    OPENWAGGLE_EXTENSION.PATH.WINDOWS_SEPARATOR,
    OPENWAGGLE_EXTENSION.PATH.POSIX_SEPARATOR,
  )
}

function sortedWorkflowFiles(files: readonly ExtensionPackageFileWrite[]) {
  return files
    .map((file) => ({
      relativePath: normalizedWorkflowFilePath(file.relativePath),
      content: file.content,
    }))
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath))
}

function updateHash(hash: ReturnType<typeof createHash>, label: string, value: string) {
  hash.update(label)
  hash.update(OPENWAGGLE_EXTENSION.HASH.FIELD_SEPARATOR)
  hash.update(value)
  hash.update(OPENWAGGLE_EXTENSION.HASH.FIELD_SEPARATOR)
}

function baseWorkflowProposalHash(input: {
  readonly operation: string
  readonly extensionId: string
  readonly scope: ExtensionPackageScope
}) {
  const hash = createHash(OPENWAGGLE_EXTENSION.HASH.ALGORITHM)
  updateHash(hash, 'proposal-version', EXTENSION_PACKAGE_WORKFLOW_PROPOSAL_VERSION)
  updateHash(hash, 'operation', input.operation)
  updateHash(hash, 'extension-id', input.extensionId)
  updateHash(hash, 'scope', scopeHashSegment(input.scope))
  return hash
}

export function getExtensionPackageWriteProposalHash(input: {
  readonly extensionId: string
  readonly scope: ExtensionPackageScope
  readonly mode: ExtensionPackageWriteMode
  readonly files: readonly ExtensionPackageFileWrite[]
}) {
  const hash = baseWorkflowProposalHash({
    operation: `write:${input.mode}`,
    extensionId: input.extensionId,
    scope: input.scope,
  })

  for (const file of sortedWorkflowFiles(input.files)) {
    updateHash(hash, 'file-path', file.relativePath)
    updateHash(hash, 'file-content', file.content)
  }

  return hash.digest(OPENWAGGLE_EXTENSION.HASH.ENCODING)
}

export function getExtensionPackageRemoveProposalHash(input: {
  readonly extensionId: string
  readonly scope: ExtensionPackageScope
}) {
  return baseWorkflowProposalHash({
    operation: 'remove',
    extensionId: input.extensionId,
    scope: input.scope,
  }).digest(OPENWAGGLE_EXTENSION.HASH.ENCODING)
}
