import { SessionId } from '@shared/types/brand'
import type { SessionDetail } from '@shared/types/session'
import { fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { describe, expect, it } from 'vitest'
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
import {
  refuseRunWithDeletedPiFile,
  withDeletedPiSessionFileNotice,
} from '../pi-session-deleted-files'

/**
 * A created Session whose Pi file was deleted continues a copy under its Pi session id, or starts
 * a new transcript. While a folder that may hold a copy cannot be read, which of the two is not
 * known: the Session is unavailable until it can be, so a Run never starts over by mistake.
 */

const FILE = '/pi/sessions/2026-01-01T00-00-00-000Z_pi-created.jsonl'
const detail: SessionDetail = {
  id: SessionId('session-created'),
  title: 'Created',
  projectPath: '/project',
  piSessionId: 'pi-created',
  piSessionFile: FILE,
  messages: [],
  createdAt: 1,
  updatedAt: 1,
}

function withFiles<A, E>(continuation: PiSessionContinuation, effect: Effect.Effect<A, E, never>) {
  const layer = Layer.mergeAll(
    Layer.succeed(
      PiSessionDiscoveryRepository,
      fromPartial<PiSessionDiscoveryRepositoryShape>({
        getProjectionState: () =>
          Effect.succeed(fromPartial({ piSessionFile: FILE, projectedPiEntryCount: 2 })),
      }),
    ),
    Layer.succeed(
      PiSessionFiles,
      fromPartial<PiSessionFilesShape>({
        isDeleted: () => Effect.succeed(true),
        unavailability: () => Effect.succeed(undefined),
        continuedFile: () => Effect.succeed(continuation),
      }),
    ),
    Layer.succeed(
      SessionProjectionRepository,
      fromPartial<SessionProjectionRepositoryShape>({
        getOptional: () => Effect.succeed(detail),
      }),
    ),
  )
  return Effect.runPromise(effect.pipe(Effect.provide(layer)))
}

describe('A created Session whose Pi file was deleted', () => {
  it('is unavailable while a folder that may hold a copy cannot be read', async () => {
    const unsearchable: PiSessionContinuation = { kind: 'unsearchable', folder: '/pi/other' }

    const opened = await withFiles(unsearchable, withDeletedPiSessionFileNotice(detail))
    const refusal = await withFiles(
      unsearchable,
      refuseRunWithDeletedPiFile(detail.id).pipe(Effect.flip),
    )

    expect(opened?.piSessionFileDeleted).toBe(
      `This Session's Pi session file is unavailable (${FILE}): it was deleted, and a folder that may hold a copy of it cannot be read. Reconnect or restore it to continue the Session.`,
    )
    expect(refusal).toEqual(expect.objectContaining({ message: opened?.piSessionFileDeleted }))
  })

  it('says its next message starts a new transcript when no folder holds a copy', async () => {
    const opened = await withFiles({ kind: 'new' }, withDeletedPiSessionFileNotice(detail))

    expect(opened?.piSessionFileDeleted).toMatch(/the next message starts a new transcript/)
  })

  it('has no notice when its Run continues a copy', async () => {
    const opened = await withFiles(
      { kind: 'file', file: '/pi/other/copy.jsonl' },
      withDeletedPiSessionFileNotice(detail),
    )

    expect(opened?.piSessionFileDeleted).toBeUndefined()
  })
})
