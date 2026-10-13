import path from 'node:path'
import { SessionManager } from '@earendil-works/pi-coding-agent'
import { SessionNodeId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { describe, expect, it, vi } from 'vitest'
import {
  messageTexts,
  run,
  sessionDetail,
  setUpPiDiscoveryFixture,
} from './pi-session-discovery.test-support'
import {
  discoveredSession,
  FAKE_PROVIDER_MODEL,
  setUpFakePiProvider,
  userNodeIds,
} from './pi-session-fake-provider.test-support'

/**
 * A discovered Pi session keys its nodes under a per-Session prefix (ADR 0051). Every operation
 * that hands a node to Pi must translate it back: a real Run, navigation, a fork, and compaction,
 * all against a local OpenAI-compatible endpoint configured the way a `pi` user configures one.
 */

const { state, getPathMock } = vi.hoisted(() => ({
  state: { userDataDir: '' },
  getPathMock: vi.fn(() => ''),
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

const fixture = setUpPiDiscoveryFixture(state)
const provider = setUpFakePiProvider(fixture)
describe('Operations on a discovered Pi session', () => {
  it('runs in the same Pi file and keeps its node ids prefixed', async () => {
    const { cli, sessionId, prefix } = await discoveredSession(fixture)
    const { executeAgentRun } = await import('../../../application/agent-run-service')

    const result = await run(
      executeAgentRun({
        sessionId,
        runId: 'run-1',
        payload: { text: 'Third question', attachments: [] },
        model: FAKE_PROVIDER_MODEL,
        signal: new AbortController().signal,
        onEvent: () => undefined,
      }),
    )

    expect(result.outcome).toBe('success')
    expect(messageTexts(await sessionDetail(sessionId)).slice(-2)).toEqual([
      'Third question',
      'Fake reply',
    ])
    // Pi wrote the turn into the CLI's own file, with its own unprefixed entry ids.
    const continued = SessionManager.open(cli.file).getEntries()
    expect(continued.length).toBeGreaterThan(4)
    expect(continued.every((entry) => !entry.id.startsWith(prefix))).toBe(true)
    expect(JSON.stringify(continued.at(-1))).toContain('Fake reply')
    expect((await userNodeIds(sessionId)).every((id) => id.startsWith(prefix))).toBe(true)
  })

  it('navigates to an earlier message by its prefixed node id', async () => {
    const { sessionId } = await discoveredSession(fixture)
    const [firstUser] = await userNodeIds(sessionId)
    const { navigateAgentSessionTree } = await import('../../../application/agent-session-service')

    const navigation = await run(
      navigateAgentSessionTree({
        sessionId,
        model: FAKE_PROVIDER_MODEL,
        targetNodeId: SessionNodeId(String(firstUser)),
      }),
    )

    expect(navigation).toMatchObject({ cancelled: false, editorText: 'First question' })
  })

  it('forks from a prefixed node into a new Session', async () => {
    const { sessionId } = await discoveredSession(fixture)
    const [, secondUser] = await userNodeIds(sessionId)
    const { forkAgentSessionToNewSession } = await import(
      '../../../application/agent-session-service'
    )

    const fork = await run(
      forkAgentSessionToNewSession({
        sessionId,
        model: FAKE_PROVIDER_MODEL,
        targetNodeId: SessionNodeId(String(secondUser)),
      }),
    )

    expect(fork.cancelled).toBe(false)
    expect(messageTexts('session' in fork ? (fork.session ?? null) : null)).toEqual([
      'First question',
      'Answer to: First question',
    ])
  })

  it.each([
    ['forks', 'before', ['First question', 'Answer to: First question']],
    [
      'clones',
      'at',
      [
        'First question',
        'Answer to: First question',
        'Second question',
        'Answer to: Second question',
      ],
    ],
  ] as const)(
    '%s through the Session lifecycle, as the desktop app does',
    async (_, position, texts) => {
      // The desktop app always has a selected model, which new Sessions' profiles start from.
      const { SettingsService } = await import('../../../services/settings-service')
      await run(
        Effect.flatMap(SettingsService, (settings) =>
          settings.update({
            enabledModels: [FAKE_PROVIDER_MODEL],
            selectedModel: FAKE_PROVIDER_MODEL,
          }),
        ),
      )
      const { sessionId } = await discoveredSession(fixture)
      const [, secondUser] = await userNodeIds(sessionId)
      const lastNode = (await sessionDetail(sessionId))?.messages.at(-1)?.id
      const { forkSession } = await import(
        '../../../application/host-ui-session-lifecycle-operations'
      )
      const target = position === 'before' ? String(secondUser) : String(lastNode)

      const fork = await run(forkSession([sessionId, FAKE_PROVIDER_MODEL, target], position))

      expect(fork.session.id).not.toBe(sessionId)
      expect(messageTexts(fork.session)).toEqual(texts)
    },
  )

  it.each([
    ['fork', 'before'],
    ['clone', 'at'],
  ] as const)('runs a %s of a session from a subfolder in that subfolder', async (_, position) => {
    const { SettingsService } = await import('../../../services/settings-service')
    await run(
      Effect.flatMap(SettingsService, (settings) =>
        settings.update({
          enabledModels: [FAKE_PROVIDER_MODEL],
          selectedModel: FAKE_PROVIDER_MODEL,
        }),
      ),
    )
    const cwd = path.join(fixture.project, 'packages', 'core')
    const { sessionId } = await discoveredSession(fixture, { cwd })
    const [, secondUser] = await userNodeIds(sessionId)
    const { forkSession } = await import(
      '../../../application/host-ui-session-lifecycle-operations'
    )
    const { resolveSessionWorkingPath } = await import('../agent-kernel/session-manager')

    const fork = await run(
      forkSession([sessionId, FAKE_PROVIDER_MODEL, String(secondUser)], position),
    )

    expect(resolveSessionWorkingPath(fork.session)).toBe(cwd)
  })

  it('compacts and keeps the summary pointing at a prefixed node', async () => {
    const { sessionId, prefix } = await discoveredSession(fixture, { long: true })
    provider.setReply('Summary of the work so far')
    const { compactAgentSession } = await import('../../../application/agent-session-service')

    const compaction = await run(compactAgentSession({ sessionId, model: FAKE_PROVIDER_MODEL }))

    expect(compaction.summary).toContain('Summary of the work so far')
    expect(compaction.firstKeptEntryId.startsWith(prefix)).toBe(true)
  })
})
