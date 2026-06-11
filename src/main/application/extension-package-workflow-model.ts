import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import { parseJsonUnknown, safeDecodeUnknown } from '@shared/schema'
import { openWaggleExtensionManifestSchema } from '@shared/schemas/extensions'
import type {
  ExtensionApplyPackageRemoveInput,
  ExtensionApplyPackageWriteInput,
  ExtensionPackageFileWrite,
  ExtensionPackageRemoveOperation,
  ExtensionPackageRemoveProposalView,
  ExtensionPackageWorkflowActor,
  ExtensionPackageWorkflowGlobalConfirmation,
  ExtensionPackageWorkflowUserApproval,
  ExtensionPackageWriteMode,
  ExtensionPackageWriteOperation,
  ExtensionPackageWriteProposalFileView,
  ExtensionPackageWriteProposalView,
  ExtensionProposePackageRemoveInput,
  ExtensionProposePackageWriteInput,
} from '@shared/types/extension-package-workflow'
import type { ExtensionPackageScope } from '../extensions/types'

const EXTENSION_PACKAGE_WORKFLOW_PROPOSAL_VERSION = '2'

export const EXTENSION_PACKAGE_WORKFLOW = {
  GLOBAL_CONFIRMATION_RISK: OPENWAGGLE_EXTENSION.PACKAGE_WORKFLOW.GLOBAL_CONFIRMATION_RISK,
  ERROR: {
    EXTENSION_ACTOR_REJECTED:
      'Extensions cannot modify extension packages. Use the user-approved extension package workflow.',
    APPROVAL_REQUIRED: 'A user approval is required before modifying an extension package.',
    APPROVAL_HASH_MISMATCH:
      'The approved extension package proposal does not match the requested package mutation.',
    GLOBAL_CONFIRMATION_REQUIRED:
      'Global extension package changes require explicit global-impact confirmation.',
    CREATE_TARGET_EXISTS: 'Create proposals require an extension package that does not exist.',
    UPDATE_TARGET_MISSING: 'Update proposals require an existing extension package.',
    MANIFEST_REQUIRED: `Extension package writes must include ${OPENWAGGLE_EXTENSION.MANIFEST_FILE}.`,
    MANIFEST_INVALID: `Extension package writes must include a valid ${OPENWAGGLE_EXTENSION.MANIFEST_FILE} manifest.`,
    MANIFEST_ID_MISMATCH:
      'Extension package manifest id must match the approved extension package id.',
  },
} as const

export type ExtensionPackageWriteManifestValidation =
  | {
      readonly _tag: 'valid'
    }
  | {
      readonly _tag: 'invalid'
      readonly message: string
    }

export type {
  ExtensionPackageWorkflowActor,
  ExtensionPackageWorkflowGlobalConfirmation,
  ExtensionPackageWorkflowUserApproval,
}

export interface ExtensionPackageWorkflowTarget {
  readonly extensionId: string
  readonly scope: ExtensionPackageScope
  readonly actor: ExtensionPackageWorkflowActor
  readonly userApproval: ExtensionPackageWorkflowUserApproval
  readonly globalConfirmation?: ExtensionPackageWorkflowGlobalConfirmation
  readonly viewProjectPaths?: readonly string[]
}

export type ExtensionPackageWriteProposalInput = ExtensionProposePackageWriteInput
export type ExtensionPackageWriteWorkflowInput = ExtensionApplyPackageWriteInput

export type ExtensionPackageRemoveProposalInput = ExtensionProposePackageRemoveInput
export type ExtensionPackageRemoveWorkflowInput = ExtensionApplyPackageRemoveInput

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

function packageWorkflowManifestFile(files: readonly ExtensionPackageFileWrite[]) {
  return (
    sortedWorkflowFiles(files).find(
      (file) => file.relativePath === OPENWAGGLE_EXTENSION.MANIFEST_FILE,
    ) ?? null
  )
}

function invalidManifestValidation(message: string): ExtensionPackageWriteManifestValidation {
  return { _tag: 'invalid', message }
}

function invalidManifestSchemaValidation(
  issues: readonly string[],
): ExtensionPackageWriteManifestValidation {
  return invalidManifestValidation(
    `${EXTENSION_PACKAGE_WORKFLOW.ERROR.MANIFEST_INVALID} ${issues.join('; ')}`,
  )
}

export function validateExtensionPackageWriteManifestIdentity(input: {
  readonly extensionId: string
  readonly files: readonly ExtensionPackageFileWrite[]
}): ExtensionPackageWriteManifestValidation {
  const manifestFile = packageWorkflowManifestFile(input.files)
  if (!manifestFile) {
    return invalidManifestValidation(EXTENSION_PACKAGE_WORKFLOW.ERROR.MANIFEST_REQUIRED)
  }

  let parsedManifest: unknown
  try {
    parsedManifest = parseJsonUnknown(manifestFile.content)
  } catch {
    return invalidManifestValidation(EXTENSION_PACKAGE_WORKFLOW.ERROR.MANIFEST_INVALID)
  }

  const decoded = safeDecodeUnknown(openWaggleExtensionManifestSchema, parsedManifest)
  if (!decoded.success) {
    return invalidManifestSchemaValidation(decoded.issues)
  }

  if (decoded.data.id !== input.extensionId) {
    return invalidManifestValidation(
      `${EXTENSION_PACKAGE_WORKFLOW.ERROR.MANIFEST_ID_MISMATCH} Expected "${input.extensionId}", received "${decoded.data.id}".`,
    )
  }

  return { _tag: 'valid' }
}

function packageFileContentHash(content: string) {
  return createHash(OPENWAGGLE_EXTENSION.HASH.ALGORITHM)
    .update(content)
    .digest(OPENWAGGLE_EXTENSION.HASH.ENCODING)
}

function packageProposalFileView(
  file: ExtensionPackageFileWrite,
): ExtensionPackageWriteProposalFileView {
  return {
    relativePath: normalizedWorkflowFilePath(file.relativePath),
    byteLength: Buffer.byteLength(file.content, 'utf8'),
    contentHash: packageFileContentHash(file.content),
  }
}

function totalProposalBytes(files: readonly ExtensionPackageWriteProposalFileView[]) {
  return files.reduce((totalBytes, file) => totalBytes + file.byteLength, 0)
}

function updateHash(hash: ReturnType<typeof createHash>, label: string, value: string) {
  hash.update(String(Buffer.byteLength(label, 'utf8')))
  hash.update(OPENWAGGLE_EXTENSION.HASH.FIELD_SEPARATOR)
  hash.update(label)
  hash.update(OPENWAGGLE_EXTENSION.HASH.FIELD_SEPARATOR)
  hash.update(String(Buffer.byteLength(value, 'utf8')))
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
    operation: getExtensionPackageWriteOperation(input.mode),
    extensionId: input.extensionId,
    scope: input.scope,
  })

  for (const file of sortedWorkflowFiles(input.files)) {
    updateHash(hash, 'file-path', file.relativePath)
    updateHash(hash, 'file-content', file.content)
  }

  return hash.digest(OPENWAGGLE_EXTENSION.HASH.ENCODING)
}

export function getExtensionPackageWriteOperation(
  mode: ExtensionPackageWriteMode,
): ExtensionPackageWriteOperation {
  return mode === 'create' ? 'write:create' : 'write:update'
}

export function getExtensionPackageRemoveOperation(): ExtensionPackageRemoveOperation {
  return 'remove'
}

export function getExtensionPackageWriteProposal(
  input: ExtensionPackageWriteProposalInput,
): ExtensionPackageWriteProposalView {
  const files = sortedWorkflowFiles(input.files).map(packageProposalFileView)
  const requiresGlobalConfirmation = input.scope.kind === OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND

  return {
    extensionId: input.extensionId,
    scope: input.scope,
    mode: input.mode,
    operation: getExtensionPackageWriteOperation(input.mode),
    actor: input.actor,
    proposalHash: getExtensionPackageWriteProposalHash(input),
    files,
    fileCount: files.length,
    totalBytes: totalProposalBytes(files),
    requiresGlobalConfirmation,
    globalConfirmationRisk: requiresGlobalConfirmation
      ? EXTENSION_PACKAGE_WORKFLOW.GLOBAL_CONFIRMATION_RISK
      : null,
  }
}

export function getExtensionPackageRemoveProposalHash(input: {
  readonly extensionId: string
  readonly scope: ExtensionPackageScope
}) {
  return baseWorkflowProposalHash({
    operation: getExtensionPackageRemoveOperation(),
    extensionId: input.extensionId,
    scope: input.scope,
  }).digest(OPENWAGGLE_EXTENSION.HASH.ENCODING)
}

export function getExtensionPackageRemoveProposal(
  input: ExtensionPackageRemoveProposalInput,
): ExtensionPackageRemoveProposalView {
  const requiresGlobalConfirmation = input.scope.kind === OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND

  return {
    extensionId: input.extensionId,
    scope: input.scope,
    operation: getExtensionPackageRemoveOperation(),
    actor: input.actor,
    proposalHash: getExtensionPackageRemoveProposalHash(input),
    requiresGlobalConfirmation,
    globalConfirmationRisk: requiresGlobalConfirmation
      ? EXTENSION_PACKAGE_WORKFLOW.GLOBAL_CONFIRMATION_RISK
      : null,
  }
}
