import { SessionId } from '@shared/types/brand'
import { fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  type PiSessionContinuation,
  PiSessionDiscoveryRepository,
  type PiSessionDiscoveryRepositoryShape,
  PiSessionFiles,
  type PiSessionFilesShape,
} from '../../ports/pi-session-discovery'
import {
  SessionProjectionRepository,
  type SessionProjectionRepositoryShape,
} from '../../ports/session-projection-repository'

const published = vi.hoisted((): unknown[] => [])
vi.mock('../../session-host/session-host-events', () => ({
  publishSessionHostEvent: (event: unknown) => published.push(event),
}))

const SESSIONS = Array.from({ length: 3 }, (_, index) => ({
  sessionId: SessionId(`created-${index}`),
  piSessionFile: `/pi/sessions/created-${index}.jsonl`,
}))

interface Files {
  readonly deletedFiles: ReadonlySet<string>
  /** What a Run of a Session whose file was deleted would continue; a new file by default. */
  continuation: PiSessionContinuation
}

function pass(
  input: Files & {
    readonly listed: readonly { readonly sessionId: SessionId; readonly piSessionFile: string }[]
    readonly projectionReads: string[]
  },
) {
  const repository = fromPartial<PiSessionDiscoveryRepositoryShape>({
    listCreatedPiSessionFiles: () => Effect.succeed(input.listed),
    getProjectionState: (sessionId: SessionId) => {
      input.projectionReads.push(String(sessionId))
      const listed = input.listed.find((entry) => entry.sessionId === sessionId)
      return Effect.succeed(
        fromPartial({ piSessionFile: listed?.piSessionFile, projectedPiEntryCount: 2 }),
      )
    },
  })
  const files = fromPartial<PiSessionFilesShape>({
    isDeleted: (file: string) => Effect.succeed(input.deletedFiles.has(file)),
    unavailability: () => Effect.succeed(undefined),
    continuedFile: () => Effect.succeed(input.continuation),
  })
  const projections = fromPartial<SessionProjectionRepositoryShape>({
    getOptional: (sessionId: SessionId) => Effect.succeed(fromPartial({ id: sessionId })),
  })
  return Effect.gen(function* () {
    const { announceCreatedSessionsWithMissingPiFiles } = yield* Effect.promise(
      () => import('../pi-session-created-file-notices'),
    )
    yield* announceCreatedSessionsWithMissingPiFiles()
  }).pipe(
    Effect.provide(
      Layer.mergeAll(
        Layer.succeed(PiSessionDiscoveryRepository, repository),
        Layer.succeed(PiSessionFiles, files),
        Layer.succeed(SessionProjectionRepository, projections),
      ),
    ),
    Effect.runPromise,
  )
}

function firstSession() {
  const session = SESSIONS[0]
  if (!session) throw new Error('No Session to delete.')
  return session
}

describe('announceCreatedSessionsWithMissingPiFiles', () => {
  beforeEach(() => {
    published.length = 0
    vi.resetModules()
  })

  it('never reads the projection state of created Sessions whose files are present', async () => {
    const projectionReads: string[] = []

    await pass({
      listed: SESSIONS,
      deletedFiles: new Set(),
      continuation: { kind: 'new' },
      projectionReads,
    })

    expect(projectionReads).toEqual([])
    expect(published).toEqual([])
  })

  it('announces a Session once while its file stays deleted, and again once it is back', async () => {
    const deleted = firstSession()
    const deletedFiles = new Set([deleted.piSessionFile])
    const projectionReads: string[] = []
    const files: Files = { deletedFiles, continuation: { kind: 'new' } }

    await pass({ listed: SESSIONS, ...files, projectionReads })
    await pass({ listed: SESSIONS, ...files, projectionReads })

    // Only the Session whose file is missing is read.
    expect(new Set(projectionReads)).toEqual(new Set([String(deleted.sessionId)]))
    expect(published).toHaveLength(1)
    deletedFiles.clear()
    const readsBefore = projectionReads.length
    await pass({ listed: SESSIONS, ...files, projectionReads })
    expect(projectionReads).toHaveLength(readsBefore)
    expect(published).toHaveLength(2)
  })

  it.each<[string, PiSessionContinuation, PiSessionContinuation]>([
    [
      'from unknown to continuing a copy',
      { kind: 'unsearchable', folder: '/pi/locked' },
      { kind: 'file', file: '/pi/other/copy.jsonl' },
    ],
    [
      'from unknown to starting over',
      { kind: 'unsearchable', folder: '/pi/locked' },
      { kind: 'new' },
    ],
    [
      'from starting over to unknown',
      { kind: 'new' },
      { kind: 'unsearchable', folder: '/pi/locked' },
    ],
    [
      'from starting over to continuing a copy',
      { kind: 'new' },
      { kind: 'file', file: '/pi/c.jsonl' },
    ],
  ])('announces a deleted file again when it changes %s', async (_case, before, after) => {
    const deleted = firstSession()
    const files: Files = { deletedFiles: new Set([deleted.piSessionFile]), continuation: before }

    await pass({ listed: SESSIONS, ...files, projectionReads: [] })
    files.continuation = after
    await pass({ listed: SESSIONS, ...files, projectionReads: [] })

    expect(published).toHaveLength(2)
  })

  it('forgets an announced Session once it is gone from the list', async () => {
    const deleted = firstSession()
    const files: Files = {
      deletedFiles: new Set([deleted.piSessionFile]),
      continuation: { kind: 'new' },
    }

    await pass({ listed: SESSIONS, ...files, projectionReads: [] })
    await pass({ listed: [], ...files, projectionReads: [] })
    // Listed again, as a restored backup would list it: announced afresh.
    await pass({ listed: SESSIONS, ...files, projectionReads: [] })

    expect(published).toHaveLength(2)
  })
})
