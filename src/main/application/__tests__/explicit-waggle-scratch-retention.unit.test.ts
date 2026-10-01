import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { SessionId, SupportedModelId } from '@shared/types/brand'
import { fromPartial } from '@total-typescript/shoehorn'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  configureSessionScratchNamespace,
  prepareSessionScratchDirectory,
  removeSessionScratchDirectory,
  sessionScratchRoot,
} from '../../utils/session-scratch-directory'
import type { WaggleRunResult } from '../waggle-run-service'

const waggleTurns = vi.hoisted(() => ({
  run: (): Promise<void> => Promise.resolve(),
}))

vi.mock('../waggle-run-service', () => ({
  executeWaggleRun: () =>
    Effect.promise(() => waggleTurns.run()).pipe(
      Effect.as(fromPartial<WaggleRunResult>({ outcome: 'success', newMessages: [] })),
    ),
}))
vi.mock('../../session-host/session-host-events', () => ({ publishSessionHostEvent: vi.fn() }))
vi.mock('../explicit-waggle-command-result', () => ({ publishExplicitWaggleResult: vi.fn() }))

const { runRegisteredExplicitWaggle } = await import('../explicit-waggle-command-runner')

describe('Explicit Waggle scratch retention', () => {
  let restoreNamespace: () => void = () => undefined
  let sessionId = ''

  beforeEach(() => {
    restoreNamespace = configureSessionScratchNamespace(`explicit-waggle-${randomUUID()}`)
    sessionId = `session-${randomUUID()}`
  })

  afterEach(async () => {
    await fs.rm(sessionScratchRoot(), { recursive: true, force: true })
    restoreNamespace()
  })

  it('keeps the scratch directory between agent turns when the Session is archived mid-Waggle', async () => {
    const directory = await prepareSessionScratchDirectory(sessionId)
    const notes = path.join(directory, 'notes.txt')
    let survivedArchive = false
    waggleTurns.run = async () => {
      // First agent's turn writes a file, then the user archives the Session.
      await fs.writeFile(notes, 'plan')
      await removeSessionScratchDirectory(sessionId)
      // The second agent's turn still finds it.
      survivedArchive = (await fs.readFile(notes, 'utf8')) === 'plan'
    }

    const waggle = runRegisteredExplicitWaggle({
      sessionId: SessionId(sessionId),
      runId: 'run-waggle',
      payload: fromPartial({ text: 'Discuss.', attachments: [] }),
      hydratedAttachments: [],
      model: SupportedModelId('provider/model'),
      config: fromPartial({}),
      abortController: new AbortController(),
    })
    // The mocked Waggle runner needs none of the services the real one does.
    const services = fromPartial<Context.Context<Effect.Effect.Context<typeof waggle>>>(
      Context.empty(),
    )
    await Effect.runPromise(waggle.pipe(Effect.provide(services)))

    expect(survivedArchive).toBe(true)
    await vi.waitFor(async () => {
      await expect(fs.access(directory)).rejects.toMatchObject({ code: 'ENOENT' })
    })
  })
})
