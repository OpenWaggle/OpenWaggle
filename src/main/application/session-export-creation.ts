import type { LocalSessionProfileAuthority } from '@shared/types/local-session-profile'
import type {
  SessionControlMutationResponse,
  SessionExportCreateMutationRequest,
} from '@shared/types/session-control'
import * as Effect from 'effect/Effect'
import { SessionAuthorizationTargetRepository } from '../ports/session-authorization-target-repository'
import { SessionExportOperationRepository } from '../ports/session-export-operation-repository'
import { assertCanonicalDirectoryRoots } from '../utils/canonical-directory-roots'
import { assertFilesystemReadDirectoryScope } from '../utils/filesystem-read-directory-scope'
import { resolveExportCallerOriginProfileId } from './session-export-live-authority'
import { dispatchSessionExport } from './session-export-operation-service'
import { acquireSessionHostRunLease } from './session-host-run-admission'

export function createSessionExport(input: {
  readonly callerId: string
  readonly authority?: LocalSessionProfileAuthority
  readonly request: SessionExportCreateMutationRequest
}) {
  return Effect.gen(function* () {
    if (input.request.command.resources?.length && input.request.command.format !== 'bundle') {
      return yield* Effect.fail(new Error('Bundled resources require the bundle export format.'))
    }
    let resourceSourceRoot: string | undefined
    if (input.request.command.resources?.length) {
      const targetRepository = yield* SessionAuthorizationTargetRepository
      const target = yield* targetRepository.resolve(input.request.command.sessionId)
      const sourceRoot = target.workingPath ?? target.projectPath
      resourceSourceRoot = yield* Effect.tryPromise({
        try: async () => {
          if (!input.authority) {
            const [canonicalSourceRoot] = await assertCanonicalDirectoryRoots(
              [sourceRoot],
              'Export resource source root',
            )
            if (!canonicalSourceRoot) throw new Error('Export resource source root is unavailable.')
            return canonicalSourceRoot
          }
          const roots = await assertCanonicalDirectoryRoots(
            input.authority.scope.exportRoots ?? [],
            'Profile export root',
          )
          if (roots.length === 0) throw new Error('Export filesystem authority was removed.')
          return assertFilesystemReadDirectoryScope({
            roots,
            directoryPath: sourceRoot,
            label: 'Export resource source root',
          })
        },
        catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
      })
    }
    const repository = yield* SessionExportOperationRepository
    const lease = yield* acquireSessionHostRunLease('export')
    let transferred = false
    return yield* Effect.gen(function* () {
      const resolvedOriginProfileId = yield* resolveExportCallerOriginProfileId(input.callerId)
      const originProfileId = input.callerId.startsWith('session-agent:')
        ? resolvedOriginProfileId
        : (resolvedOriginProfileId ?? input.authority?.profileId)
      const result = yield* repository.create({
        callerId: input.callerId,
        ...(originProfileId ? { originProfileId } : {}),
        idempotencyKey: input.request.idempotencyKey,
        command: input.request.command,
        ...(resourceSourceRoot ? { resourceSourceRoot } : {}),
        now: Date.now(),
      })
      transferred = yield* dispatchSessionExport(result.operation, lease)
      return {
        contractVersion: input.request.contractVersion,
        requestId: input.request.requestId,
        idempotencyKey: input.request.idempotencyKey,
        replayed: result.replayed,
        outcome: {
          operation: 'export-create',
          effect: 'export-accepted',
          sessionId: result.operation.sessionId,
          exportOperationId: result.operation.exportOperationId,
          status: result.operation.status,
        },
      } satisfies SessionControlMutationResponse
    }).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          if (!transferred) lease.release()
        }),
      ),
    )
  })
}
