import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import { RunId, SessionId } from '@shared/types/brand'
import { DEFAULT_SETTINGS } from '@shared/types/settings'
import { fromPartial } from '@total-typescript/shoehorn'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SessionControlAttachmentService } from '../../ports/session-control-attachment-service'
import { SessionControlRunExecutor } from '../../ports/session-control-run-executor'
import { SettingsService } from '../../services/settings-service'
import {
  configureSessionScratchNamespace,
  prepareSessionScratchDirectory,
  removeSessionScratchDirectory,
  sessionScratchRoot,
} from '../../utils/session-scratch-directory'

/** Long enough for a removal that was not deferred to finish before capture reads the image. */
const CAPTURE_WORK_MS = 100

const run = vi.hoisted(() => ({
  turn: (): Promise<void> => Promise.resolve(),
  capture: (): Promise<void> => Promise.resolve(),
}))

vi.mock('../session-control-run-dispatch', () => ({
  executeRegisteredRun: () =>
    Effect.promise(async () => {
      await run.turn()
      const result = { outcome: 'success', newMessages: [], resourceMessages: [] }
      return { mode: 'classic', result, resourceResult: result, payload: { text: 'Go.' } }
    }),
}))
vi.mock('../../application/session-resource-run-result', () => ({
  captureRunResultResources: () => Effect.promise(() => run.capture()),
}))
vi.mock('../sqlite-session-live-authority', () => ({
  liveSessionAuthorityBlockReason: () => Effect.succeed(undefined),
  loadSessionAuthoritySnapshot: () => Effect.succeed(undefined),
}))
vi.mock('../session-control-run-executor-profile', () => ({
  loadRunExecutionProfile: () => Effect.succeed({ model: 'provider/model', projectPath: null }),
}))
vi.mock('../../utils/stream-bridge', () => ({ startStreamBuffer: vi.fn() }))

const { SessionControlRunExecutorLive } = await import('../session-control-run-executor')

describe('Session Control Run scratch retention', () => {
  const restores: (() => void)[] = []

  afterEach(async () => {
    await fs.rm(sessionScratchRoot(), { recursive: true, force: true })
    for (const restore of restores.splice(0)) restore()
  })

  it('holds the scratch directory through resource capture when archived mid-Run', async () => {
    restores.push(configureSessionScratchNamespace(`run-executor-${randomUUID()}`))
    const sessionId = SessionId(`session-${randomUUID()}`)
    const directory = await prepareSessionScratchDirectory(sessionId)
    const image = path.join(directory, 'final.png')
    run.turn = async () => {
      await fs.writeFile(image, 'png')
      // The user archives the Session while the last turn is still running.
      await removeSessionScratchDirectory(sessionId)
    }
    let imageAtCapture: string | undefined
    run.capture = async () => {
      await new Promise((resolve) => setTimeout(resolve, CAPTURE_WORK_MS))
      imageAtCapture = await fs.readFile(image, 'utf8').catch(() => undefined)
    }
    const services = Layer.mergeAll(
      Layer.succeed(SqlClient.SqlClient, fromPartial<SqlClient.SqlClient>({})),
      Layer.succeed(SettingsService, fromPartial({ get: () => Effect.succeed(DEFAULT_SETTINGS) })),
      Layer.succeed(SessionControlAttachmentService, fromPartial({ release: () => Effect.void })),
    )
    // The mocked Run touches none of the executor's other services.
    const context = fromPartial<
      Context.Context<Layer.Layer.Context<typeof SessionControlRunExecutorLive>>
    >(Context.empty())

    await Effect.runPromise(
      Effect.flatMap(SessionControlRunExecutor, (executor) =>
        executor.execute({
          sessionId,
          runId: RunId('run-archived'),
          intent: fromPartial({ callerId: 'gui:local-user', text: 'Go.', attachmentIds: [] }),
          controller: new AbortController(),
        }),
      ).pipe(
        Effect.provide(SessionControlRunExecutorLive),
        Effect.provide(services),
        Effect.provide(context),
      ),
    )

    expect(imageAtCapture).toBe('png')
    await vi.waitFor(async () => {
      await expect(fs.access(directory)).rejects.toMatchObject({ code: 'ENOENT' })
    })
  })
})
