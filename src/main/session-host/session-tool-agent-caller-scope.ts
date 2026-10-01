import * as Effect from 'effect/Effect'
import {
  assertSessionAuthoritySnapshot,
  type decodeSessionAuthoritySnapshot,
} from './session-authority-snapshot'

/** The Sessions tool scope of a Session agent: every project, its project, or listed Sessions. */
export function agentBaseScope(input: {
  readonly everyProject: boolean
  readonly sharedProjectPath: string | undefined
  readonly sessionIds: readonly string[]
  readonly filesystemRoot: string
}) {
  const roots = { exportRoots: [input.filesystemRoot], attachmentRoots: [input.filesystemRoot] }
  if (input.everyProject) return { all: true, ...roots }
  if (input.sharedProjectPath !== undefined) {
    return { projectPaths: [input.sharedProjectPath], ...roots }
  }
  return { sessionIds: [...input.sessionIds], ...roots }
}

/** A stored authority snapshot binds the Session to the Workspace it was granted for. */
export function assertSnapshotStillHolds(
  authoritySnapshot: ReturnType<typeof decodeSessionAuthoritySnapshot>,
  workingDirectory: string,
) {
  if (!authoritySnapshot) return Effect.void
  return Effect.tryPromise({
    try: async () => {
      await assertSessionAuthoritySnapshot(authoritySnapshot)
      if (workingDirectory !== authoritySnapshot.workingPath) {
        throw new Error('Session working directory differs from its authority snapshot.')
      }
    },
    catch: (cause) => new Error('Session authority changed after it was granted.', { cause }),
  })
}
