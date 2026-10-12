import { SessionId } from '@shared/types/brand'
import { fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  PiSessionDiscoveryRepository,
  type PiSessionDiscoveryRepositoryShape,
  PiSessionFiles,
  type PiSessionFilesShape,
} from '../../ports/pi-session-discovery'

const published = vi.hoisted((): unknown[] => [])
vi.mock('../../session-host/session-host-events', () => ({
  publishSessionHostEvent: (event: unknown) => published.push(event),
}))

const SESSIONS = Array.from({ length: 3 }, (_, index) => ({
  sessionId: SessionId(`created-${index}`),
  piSessionFile: `/pi/sessions/created-${index}.jsonl`,
}))

function pass(input: {
  readonly listed: readonly { readonly sessionId: SessionId; readonly piSessionFile: string }[]
  readonly deletedFiles: ReadonlySet<string>
  readonly projectionReads: string[]
}) {
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
      ),
    ),
    Effect.runPromise,
  )
}

describe('announceCreatedSessionsWithMissingPiFiles', () => {
  beforeEach(() => {
    published.length = 0
    vi.resetModules()
  })

  it('never reads the projection state of created Sessions whose files are present', async () => {
    const projectionReads: string[] = []

    await pass({ listed: SESSIONS, deletedFiles: new Set(), projectionReads })

    expect(projectionReads).toEqual([])
    expect(published).toEqual([])
  })

  it('reads an announced Session again only to see whether its file is back', async () => {
    const deleted = SESSIONS[0]
    if (!deleted) throw new Error('No Session to delete.')
    const deletedFiles = new Set([deleted.piSessionFile])
    const projectionReads: string[] = []

    await pass({ listed: SESSIONS, deletedFiles, projectionReads })
    await pass({ listed: SESSIONS, deletedFiles, projectionReads })

    expect(projectionReads).toEqual([String(deleted.sessionId)])
    expect(published).toHaveLength(1)
    deletedFiles.clear()
    await pass({ listed: SESSIONS, deletedFiles, projectionReads })
    expect(projectionReads).toEqual([String(deleted.sessionId)])
    expect(published).toHaveLength(2)
  })

  it('forgets an announced Session once it is gone from the list', async () => {
    const deleted = SESSIONS[0]
    if (!deleted) throw new Error('No Session to delete.')
    const deletedFiles = new Set([deleted.piSessionFile])
    const projectionReads: string[] = []

    await pass({ listed: SESSIONS, deletedFiles, projectionReads })
    await pass({ listed: [], deletedFiles, projectionReads })
    // Listed again, as a restored backup would list it: announced afresh.
    await pass({ listed: SESSIONS, deletedFiles, projectionReads })

    expect(published).toHaveLength(2)
  })
})
