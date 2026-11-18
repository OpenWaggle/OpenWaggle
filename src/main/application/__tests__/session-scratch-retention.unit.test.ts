import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  configureSessionScratchNamespace,
  prepareSessionScratchDirectory,
  removeSessionScratchDirectory,
  sessionScratchRoot,
} from '../../utils/session-scratch-directory'
import { runAndCaptureWithRetainedScratch } from '../session-scratch-retention'

describe('Session scratch retention through resource capture', () => {
  let restoreNamespace: () => void = () => undefined
  let sessionId = ''

  beforeEach(() => {
    // An own namespace, removed afterwards, so the shared default one is not touched.
    restoreNamespace = configureSessionScratchNamespace(`scratch-retention-${randomUUID()}`)
    sessionId = `session-${randomUUID()}`
  })

  afterEach(async () => {
    await fs.rm(sessionScratchRoot(), { recursive: true, force: true })
    restoreNamespace()
  })

  it('keeps an image for capture when the Session is archived during its last turn', async () => {
    const directory = await prepareSessionScratchDirectory(sessionId)
    const image = path.join(directory, 'electron-qa-evidence', 'final.png')

    const captured = await Effect.runPromise(
      runAndCaptureWithRetainedScratch({
        sessionId,
        run: Effect.promise(async () => {
          await fs.mkdir(path.dirname(image))
          await fs.writeFile(image, 'png')
          // The user archives the Session while the turn is still running.
          await removeSessionScratchDirectory(sessionId)
        }),
        capture: () => Effect.promise(() => fs.readFile(image, 'utf8')).pipe(Effect.asVoid),
      }).pipe(Effect.as('captured')),
    )

    expect(captured).toBe('captured')
    await vi.waitFor(async () => {
      await expect(fs.access(directory)).rejects.toMatchObject({ code: 'ENOENT' })
    })
  })
})
