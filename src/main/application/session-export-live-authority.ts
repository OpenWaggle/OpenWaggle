import path from 'node:path'
import type { LocalSessionCallerIdentity } from '@shared/types/local-session-profile'
import * as Effect from 'effect/Effect'
import { requiredSessionControlCapabilities } from '../domain/session-control/session-capability-authorization'
import {
  type SessionExportAuthorityTarget,
  SessionExportLiveAuthority,
} from '../ports/session-export-live-authority'
import type { SessionExportOperationRecord } from '../ports/session-export-operation-repository'
import { assertCanonicalDirectoryRoots } from '../utils/canonical-directory-roots'
import { authorizeTargetForCaller } from './local-session-derived-authority'

function requiresLiveAuthority(callerId: string) {
  return (
    callerId.startsWith('profile:') ||
    callerId.startsWith('session-agent:') ||
    callerId.startsWith('transient-mcp:')
  )
}

async function validateFilesystemAuthority(input: {
  readonly operation: SessionExportOperationRecord
  readonly target: SessionExportAuthorityTarget
  readonly exportRoots: readonly string[]
}) {
  const canonicalRoots = await assertCanonicalDirectoryRoots(
    input.exportRoots,
    'Profile export root',
  )
  const [destinationRoot] = await assertCanonicalDirectoryRoots(
    [input.operation.destinationRoot ?? ''],
    'Export destination root',
  )
  const isAuthorizedRoot = (candidate: string) =>
    canonicalRoots.some((root) => {
      const relative = path.relative(root, candidate)
      return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
    })
  if (!isAuthorizedRoot(destinationRoot ?? '')) {
    throw new Error('Export destination root is no longer authorized.')
  }
  if (input.operation.resources.length === 0) return undefined
  const sourceRoot = input.target.workingPath ?? input.target.projectPath
  if (!sourceRoot) throw new Error('Export resource source root is unavailable.')
  const [canonicalSourceRoot] = await assertCanonicalDirectoryRoots(
    [sourceRoot],
    'Export resource source root',
  )
  if (!canonicalSourceRoot || !isAuthorizedRoot(canonicalSourceRoot)) {
    throw new Error('Export resource source root is no longer authorized.')
  }
  return canonicalSourceRoot
}

function exportRequiredCapabilities(operation: SessionExportOperationRecord) {
  return requiredSessionControlCapabilities({
    operation: 'export-create',
    sessionId: operation.sessionId,
    format: operation.format,
    destinationPath: operation.destinationPath,
    branchScope: operation.branchScope,
    ...(operation.branchId ? { branchId: operation.branchId } : {}),
    ...(operation.overwriteExisting ? { overwriteExisting: true } : {}),
    ...(operation.includeQueueBodies ? { includeQueueBodies: true } : {}),
    ...(operation.resources.length > 0 ? { resources: operation.resources } : {}),
  })
}

function assertProfileAuthority(
  operation: SessionExportOperationRecord,
  target: SessionExportAuthorityTarget,
  caller: LocalSessionCallerIdentity,
) {
  const targetAuthorized = authorizeTargetForCaller(
    caller,
    {
      sessionId: target.sessionId,
      ...(target.projectPath ? { projectPath: target.projectPath } : {}),
      hiveRootSessionId: target.hiveRootSessionId,
    },
    exportRequiredCapabilities(operation),
  ).authorized
  if (!targetAuthorized) throw new Error('Export profile authority changed.')
}

export function resolveExportCallerOriginProfileId(callerId: string) {
  return Effect.gen(function* () {
    const authority = yield* SessionExportLiveAuthority
    return yield* authority.resolveOriginProfileId(callerId)
  })
}

export function resolveExportOriginProfileId(operation: SessionExportOperationRecord) {
  return resolveExportCallerOriginProfileId(operation.callerId)
}

export function ensureLiveExportAuthority(operation: SessionExportOperationRecord) {
  return Effect.gen(function* () {
    const expectedWorkspacePath =
      operation.resources.length > 0 ? operation.resourceSourceRoot : undefined
    if (operation.resources.length > 0 && !expectedWorkspacePath) {
      return yield* Effect.fail(new Error('Export resource source authority is unavailable.'))
    }
    if (!requiresLiveAuthority(operation.callerId)) return expectedWorkspacePath
    const authority = yield* SessionExportLiveAuthority
    const reason = yield* authority.liveAuthorityBlockReason(
      operation.callerId,
      operation.sessionId,
    )
    if (reason) {
      return yield* Effect.fail(new Error(`Export authority is no longer valid: ${reason}.`))
    }
    if (operation.callerId.startsWith('transient-mcp:')) return expectedWorkspacePath
    const target = yield* authority.loadTarget(operation.sessionId)
    if (!target) return yield* Effect.fail(new Error('Export target Session was removed.'))
    const caller = yield* authority.loadCaller(operation.callerId)
    const exportRoots = caller.profileAuthority?.scope.exportRoots ?? []
    if (!operation.destinationRoot || exportRoots.length === 0) {
      return yield* Effect.fail(new Error('Export filesystem authority was removed.'))
    }
    const currentWorkspacePath = yield* Effect.tryPromise({
      try: () => validateFilesystemAuthority({ operation, target, exportRoots }),
      catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
    })
    yield* Effect.try({
      try: () => assertProfileAuthority(operation, target, caller),
      catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
    })
    if (currentWorkspacePath !== expectedWorkspacePath) {
      return yield* Effect.fail(new Error('Export resource source workspace changed.'))
    }
    return expectedWorkspacePath
  })
}
