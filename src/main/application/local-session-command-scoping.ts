import type { LocalSessionCallerIdentity } from '@shared/types/local-session-profile'
import type { LocalSessionCommandPayload } from '@shared/types/local-session-protocol'
import * as Effect from 'effect/Effect'
import { SessionAuthorizationTargetRepository } from '../ports/session-authorization-target-repository'
import { assertCanonicalDirectoryRoots } from '../utils/canonical-directory-roots'
import { assertFilesystemReadDirectoryScope } from '../utils/filesystem-read-directory-scope'
import { assertFilesystemWriteScope } from '../utils/filesystem-write-scope'
import { validateRequiredProjectPath } from '../utils/project-path-validation'

export function scopeNamedProfileExport(
  caller: LocalSessionCallerIdentity,
  payload: LocalSessionCommandPayload,
) {
  if (
    !caller.profileAuthority ||
    payload.contract !== 'session-control-v2' ||
    payload.request.command.operation !== 'export-create'
  ) {
    return Effect.succeed(payload)
  }
  const command = payload.request.command
  return Effect.gen(function* () {
    const configuredRoots = caller.profileAuthority?.scope.exportRoots ?? []
    const roots = yield* Effect.tryPromise({
      try: () => assertCanonicalDirectoryRoots(configuredRoots, 'Profile export root'),
      catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
    })
    if (roots.length === 0) {
      return yield* Effect.fail(
        new Error('Creating a Session export requires an explicit filesystem workspace grant.'),
      )
    }
    const scope = yield* Effect.tryPromise({
      try: () => assertFilesystemWriteScope({ roots, destinationPath: command.destinationPath }),
      catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
    })
    if ((command.resources?.length ?? 0) > 0) {
      const repository = yield* SessionAuthorizationTargetRepository
      const target = yield* repository.resolve(command.sessionId)
      const resourceRoot = target.workingPath ?? target.projectPath
      yield* Effect.tryPromise({
        try: () =>
          assertFilesystemReadDirectoryScope({
            roots,
            directoryPath: resourceRoot,
            label: 'Export resource source root',
          }),
        catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
      })
    }
    return {
      ...payload,
      request: {
        ...payload.request,
        command: {
          ...command,
          destinationPath: scope.destinationPath,
          destinationRoot: scope.rootPath,
        },
      },
    } satisfies LocalSessionCommandPayload
  })
}

export function canonicalizeNamedProfileProjectPayload(
  caller: LocalSessionCallerIdentity,
  payload: LocalSessionCommandPayload,
) {
  if (!caller.profileAuthority) return Effect.succeed(payload)
  if (payload.contract === 'session-lifecycle-v2') {
    const command = payload.request.command
    if (command.operation !== 'create' && command.operation !== 'launch') {
      return Effect.succeed(payload)
    }
    return validateRequiredProjectPath(command.projectPath).pipe(
      Effect.map(
        (projectPath) =>
          ({
            ...payload,
            request: { ...payload.request, command: { ...command, projectPath } },
          }) satisfies LocalSessionCommandPayload,
      ),
    )
  }
  if (payload.contract !== 'session-query-v2') return Effect.succeed(payload)
  const query = payload.request.query
  if (!('projectPath' in query) || !query.projectPath) return Effect.succeed(payload)
  return validateRequiredProjectPath(query.projectPath).pipe(
    Effect.map(
      (projectPath) =>
        ({
          ...payload,
          request: { ...payload.request, query: { ...query, projectPath } },
        }) satisfies LocalSessionCommandPayload,
    ),
  )
}
