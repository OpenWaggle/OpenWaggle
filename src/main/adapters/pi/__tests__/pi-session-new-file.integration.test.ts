import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { SessionId } from '@shared/types/brand'
import { SESSION_LIFECYCLE_CONTRACT_VERSION } from '@shared/types/session-lifecycle'
import * as Effect from 'effect/Effect'
import { describe, expect, it, vi } from 'vitest'
import { run, sessionDetail, setUpPiDiscoveryFixture } from './pi-session-discovery.test-support'
import { FAKE_PROVIDER_MODEL, setUpFakePiProvider } from './pi-session-fake-provider.test-support'

/**
 * A Session OpenWaggle creates records the Pi file it will use before Pi writes it. Its first
 * Run writes that file, under the recorded name, and does not take it for one deleted outside
 * OpenWaggle.
 */

const { state, getPathMock, warnings } = vi.hoisted(() => ({
  state: { userDataDir: '' },
  getPathMock: vi.fn(() => ''),
  warnings: new Array<string>(),
}))

getPathMock.mockImplementation(() => state.userDataDir)

vi.mock('electron', () => ({
  app: { getPath: getPathMock },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (value: string) => Buffer.from(value, 'utf8'),
    decryptString: (value: Buffer) => value.toString('utf8'),
  },
}))

vi.mock('../../../logger', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../logger')>()
  return {
    ...original,
    createLogger: (namespace: string) => {
      const logger = original.createLogger(namespace)
      return {
        ...logger,
        warn: (message: string, data?: object) => {
          warnings.push(`${namespace}: ${message}`)
          logger.warn(message, data)
        },
      }
    },
  }
})

const fixture = setUpPiDiscoveryFixture(state)
setUpFakePiProvider(fixture)

async function createdSession(
  workspace: { readonly mode: 'local' } | { readonly mode: 'new-worktree' } = { mode: 'local' },
) {
  const { SettingsService } = await import('../../../services/settings-service')
  await run(
    Effect.flatMap(SettingsService, (settings) =>
      settings.update({ enabledModels: [FAKE_PROVIDER_MODEL], selectedModel: FAKE_PROVIDER_MODEL }),
    ),
  )
  const { dispatchLocalSessionCommand } = await import(
    '../../../application/local-session-command-dispatcher'
  )
  const result = await run(
    dispatchLocalSessionCommand({
      caller: { callerId: 'gui:local-user', workingDirectory: fixture.project },
      payload: {
        contract: 'session-lifecycle-v2',
        request: {
          contractVersion: SESSION_LIFECYCLE_CONTRACT_VERSION,
          requestId: randomUUID(),
          idempotencyKey: randomUUID(),
          command: {
            operation: 'create',
            projectPath: fixture.project,
            title: 'New Session',
            workspace,
          },
        },
      },
    }),
  )
  if (result.contract !== 'session-lifecycle-v2') throw new Error('Not a lifecycle response.')
  const outcome = result.response.outcome
  if (outcome.effect !== 'created-root') throw new Error(`Not created: ${outcome.effect}`)
  return SessionId(outcome.sessionId)
}

describe("A new Session's first Run", () => {
  it('writes the Pi file recorded at creation, and reports no deleted file', async () => {
    const sessionId = await createdSession()
    const recorded = (await sessionDetail(sessionId))?.piSessionFile
    if (!recorded) throw new Error('The Session recorded no Pi file.')
    expect(existsSync(recorded)).toBe(false)
    const { executeAgentRun } = await import('../../../application/agent-run-service')

    const result = await run(
      executeAgentRun({
        sessionId,
        runId: 'run-first',
        payload: { text: 'Hello', attachments: [] },
        model: FAKE_PROVIDER_MODEL,
        signal: new AbortController().signal,
        onEvent: () => undefined,
      }),
    )

    expect(result.outcome).toBe('success')
    expect((await sessionDetail(sessionId))?.piSessionFile).toBe(recorded)
    expect(existsSync(recorded)).toBe(true)
    expect(warnings.filter((warning) => warning.includes('deleted outside OpenWaggle'))).toEqual([])
  })

  it("keeps a worktree Session's file in the project's sessionDir through the first send", async () => {
    await fs.mkdir(path.join(fixture.project, '.pi'), { recursive: true })
    await fs.writeFile(
      path.join(fixture.project, '.pi', 'settings.json'),
      JSON.stringify({ sessionDir: '.pi/sessions' }),
    )
    await fs.writeFile(path.join(fixture.project, '.gitignore'), '.pi/sessions/\n')
    const git = (...args: string[]) => execFileSync('git', args, { cwd: fixture.project })
    git('init', '-q')
    git('-c', 'user.email=t@example.com', '-c', 'user.name=t', 'add', '.')
    git('-c', 'user.email=t@example.com', '-c', 'user.name=t', 'commit', '-qm', 'init')
    const sessionId = await createdSession({ mode: 'new-worktree' })
    const recorded = (await sessionDetail(sessionId))?.piSessionFile
    const { executeAgentRun } = await import('../../../application/agent-run-service')

    // The first send creates the worktree, which has the project's settings too.
    const result = await run(
      executeAgentRun({
        sessionId,
        runId: 'run-first-worktree',
        payload: { text: 'Hello from a worktree', attachments: [] },
        model: FAKE_PROVIDER_MODEL,
        signal: new AbortController().signal,
        onEvent: () => undefined,
      }),
    )

    expect(result.outcome).toBe('success')
    const detail = await sessionDetail(sessionId)
    expect(detail?.worktreePath).toBeTruthy()
    expect(detail?.piSessionFile).toBe(recorded)
    expect(path.dirname(String(detail?.piSessionFile))).toBe(
      path.join(fixture.project, '.pi', 'sessions'),
    )
    expect(existsSync(path.join(String(detail?.worktreePath), '.pi', 'sessions'))).toBe(false)
  }, 180_000)
})
