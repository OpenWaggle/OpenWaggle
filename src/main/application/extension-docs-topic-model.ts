import { createHash } from 'node:crypto'
import { readFile, realpath } from 'node:fs/promises'
import path from 'node:path'
import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import type { ExtensionDocsTopicDeclaration } from '@shared/schemas/extensions'
import type {
  DocsDiscoveryDiagnostic,
  ExtensionDocsLifecycleState,
  ExtensionDocsTopicSummary,
  ExtensionDocsTrustState,
} from '@shared/types/docs'
import type { ExtensionPackageScopeView } from '@shared/types/extensions'
import * as Effect from 'effect/Effect'
import { isExtensionCurrentTrustPin } from '../extensions/runtime-eligibility'
import type {
  DiscoveredExtensionPackage,
  ExtensionLifecycleState,
  ExtensionPackageScope,
} from '../extensions/types'
import { isPathInside } from '../utils/paths'

const HASH_ALGORITHM = 'sha256'
const HASH_ENCODING = 'hex'
const EXTENSION_DOC_TOPIC_PREFIX = 'extension:'

export interface ExtensionPackageWithLifecycle {
  readonly extensionPackage: DiscoveredExtensionPackage
  readonly lifecycle: ExtensionLifecycleState | null
  readonly diagnostics: readonly DocsDiscoveryDiagnostic[]
}

interface ExtensionDocFileLookup {
  readonly path: string
  readonly contentHash: string | null
  readonly diagnostics: readonly DocsDiscoveryDiagnostic[]
}

export function packageLoadDiagnostic(input: {
  readonly operation: string
  readonly error: unknown
  readonly path?: string
}): DocsDiscoveryDiagnostic {
  return {
    severity: 'error',
    code: 'extension-docs-discovery-failed',
    message: `${input.operation}: ${input.error instanceof Error ? input.error.message : String(input.error)}`,
    ...(input.path !== undefined ? { path: input.path } : {}),
  }
}

function scopeToView(scope: ExtensionPackageScope): ExtensionPackageScopeView {
  if (scope.kind === OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND) {
    return { kind: OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND, label: 'Global' }
  }
  return {
    kind: OPENWAGGLE_EXTENSION.SCOPE.PROJECT_KIND,
    label: 'Project',
    projectPath: scope.projectPath,
  }
}

function extensionTrustState(input: {
  readonly extensionPackage: DiscoveredExtensionPackage
  readonly lifecycle: ExtensionLifecycleState | null
}): ExtensionDocsTrustState {
  const { lifecycle } = input
  if (!lifecycle) {
    return 'unknown'
  }
  return isExtensionCurrentTrustPin({ extensionPackage: input.extensionPackage, lifecycle })
    ? 'trusted'
    : 'untrusted'
}

function extensionLifecycleState(
  lifecycle: ExtensionLifecycleState | null,
): ExtensionDocsLifecycleState {
  if (!lifecycle) {
    return 'unavailable'
  }
  return lifecycle.enabled ? 'enabled' : 'disabled'
}

function invalidDocPath(input: {
  readonly candidatePath: string
  readonly relativePath: string
  readonly message: string
}): ExtensionDocFileLookup {
  return {
    path: input.candidatePath,
    contentHash: null,
    diagnostics: [
      {
        severity: 'error',
        code: 'extension-doc-path-invalid',
        message: input.message,
        path: input.relativePath,
      },
    ],
  }
}

async function getExtensionDocFile(input: {
  readonly packagePath: string
  readonly relativePath: string
}): Promise<ExtensionDocFileLookup> {
  const resolvedPackagePath = path.resolve(input.packagePath)
  const candidatePath = path.resolve(input.packagePath, input.relativePath)
  if (!isPathInside(resolvedPackagePath, candidatePath)) {
    return invalidDocPath({
      candidatePath,
      relativePath: input.relativePath,
      message: 'Declared extension doc path escapes the extension package root.',
    })
  }

  try {
    const [realPackagePath, realCandidatePath] = await Promise.all([
      realpath(input.packagePath),
      realpath(candidatePath),
    ])
    if (!isPathInside(realPackagePath, realCandidatePath)) {
      return invalidDocPath({
        candidatePath,
        relativePath: input.relativePath,
        message: 'Declared extension doc path resolves outside the extension package root.',
      })
    }

    const content = await readFile(realCandidatePath)
    return {
      path: realCandidatePath,
      contentHash: createHash(HASH_ALGORITHM).update(content).digest(HASH_ENCODING),
      diagnostics: [],
    }
  } catch (error) {
    return {
      path: candidatePath,
      contentHash: null,
      diagnostics: [
        {
          severity: 'error',
          code: 'extension-doc-read-failed',
          message: `Failed to inspect declared extension doc: ${error instanceof Error ? error.message : String(error)}`,
          path: input.relativePath,
        },
      ],
    }
  }
}

function extensionDocTopicId(extensionId: string, localTopic: string) {
  return `${EXTENSION_DOC_TOPIC_PREFIX}${extensionId}/${localTopic}`
}

function topicFromExtensionDoc(input: {
  readonly extensionPackage: DiscoveredExtensionPackage
  readonly lifecycle: ExtensionLifecycleState | null
  readonly declaration: ExtensionDocsTopicDeclaration
  readonly file: ExtensionDocFileLookup
  readonly lifecycleDiagnostics: readonly DocsDiscoveryDiagnostic[]
}): ExtensionDocsTopicSummary {
  const manifest = input.extensionPackage.manifest
  return {
    topic: extensionDocTopicId(input.extensionPackage.id, input.declaration.id),
    localTopic: input.declaration.id,
    title: input.declaration.title,
    ...(input.declaration.description !== undefined
      ? { description: input.declaration.description }
      : {}),
    path: input.file.path,
    aliases: input.declaration.aliases ?? [],
    keywords: input.declaration.keywords ?? [],
    contentHash: input.file.contentHash,
    provenance: {
      extensionId: input.extensionPackage.id,
      extensionName: manifest?.name ?? null,
      extensionVersion: manifest?.version ?? null,
      scope: scopeToView(input.extensionPackage.scope),
      packagePath: input.extensionPackage.packagePath,
      manifestPath: input.extensionPackage.manifestPath,
      path: input.file.path,
      packageContentHash: input.extensionPackage.contentHash,
      trust: extensionTrustState({
        extensionPackage: input.extensionPackage,
        lifecycle: input.lifecycle,
      }),
      lifecycle: extensionLifecycleState(input.lifecycle),
    },
    diagnostics: [...input.lifecycleDiagnostics, ...input.file.diagnostics],
  }
}

export function extensionPackageDocs(input: ExtensionPackageWithLifecycle) {
  const declarations = input.extensionPackage.manifest?.docs?.topics ?? []
  return Effect.forEach(declarations, (declaration) =>
    Effect.promise(() =>
      getExtensionDocFile({
        packagePath: input.extensionPackage.packagePath,
        relativePath: declaration.path,
      }),
    ).pipe(
      Effect.map((file) =>
        topicFromExtensionDoc({
          extensionPackage: input.extensionPackage,
          lifecycle: input.lifecycle,
          declaration,
          file,
          lifecycleDiagnostics: input.diagnostics,
        }),
      ),
    ),
  )
}

export function compareExtensionTopics(
  left: ExtensionDocsTopicSummary,
  right: ExtensionDocsTopicSummary,
) {
  return left.topic.localeCompare(right.topic)
}
