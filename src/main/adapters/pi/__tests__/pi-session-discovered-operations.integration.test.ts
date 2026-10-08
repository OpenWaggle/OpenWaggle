import fs from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import path from 'node:path'
import { SessionManager } from '@earendil-works/pi-coding-agent'
import { type SessionId, SessionNodeId, SupportedModelId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  continuePiCliSession,
  createPiCliSession,
  discoverOne,
  messageTexts,
  openSession,
  registerProjects,
  run,
  sessionDetail,
  setUpPiDiscoveryFixture,
  writeVersion2PiSession,
} from './pi-session-discovery.test-support'

/**
 * A discovered Pi session keys its nodes under a per-Session prefix (ADR 0050). Every operation
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
const MODEL = SupportedModelId('local/fake-model')
let server: Server | undefined
let reply = 'Fake reply'

function chunk(delta: object, finishReason: string | null) {
  return `data: ${JSON.stringify({
    id: 'fake',
    object: 'chat.completion.chunk',
    created: 1,
    model: 'fake-model',
    choices: [{ index: 0, delta, finish_reason: finishReason }],
    ...(finishReason
      ? { usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 } }
      : {}),
  })}\n\n`
}

/** An OpenAI-compatible streaming endpoint answering every request with `reply`. */
async function startFakeEndpoint() {
  server = createServer((request, response) => {
    request.resume()
    request.on('end', () => {
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.write(chunk({ role: 'assistant', content: reply }, null))
      response.write(chunk({}, 'stop'))
      response.end('data: [DONE]\n\n')
    })
  })
  await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('The fake endpoint has no port.')
  return `http://127.0.0.1:${String((address satisfies AddressInfo).port)}/v1`
}

beforeEach(async () => {
  // MCP and skill discovery read the home directory; keep the user's own out of the test.
  vi.stubEnv('HOME', path.join(fixture.root, 'home'))
  const baseUrl = await startFakeEndpoint()
  const agentDir = path.join(fixture.root, 'pi-agent')
  await fs.mkdir(agentDir, { recursive: true })
  await fs.writeFile(
    path.join(agentDir, 'models.json'),
    JSON.stringify({
      providers: {
        local: {
          baseUrl,
          api: 'openai-completions',
          apiKey: 'local-key',
          models: [{ id: 'fake-model', contextWindow: 100_000, maxTokens: 1_000 }],
        },
      },
    }),
  )
  await registerProjects([fixture.project])
})

afterEach(async () => {
  await new Promise<void>((resolve) => server?.close(() => resolve()))
  server = undefined
  reply = 'Fake reply'
})

/** Long enough for compaction to have earlier turns to summarize. */
const LONG_TURNS = 3
const LONG_PROMPT_WORDS = 15_000

/** A discovered session with two exchanges, opened once so it is projected. */
async function discoveredSession(options: { readonly long?: boolean } = {}) {
  const cli = createPiCliSession(fixture.project, 'First question')
  continuePiCliSession(cli.file, 'Second question')
  for (let turn = 0; options.long && turn < LONG_TURNS; turn++) {
    continuePiCliSession(cli.file, `Long turn ${String(turn)} ${'word '.repeat(LONG_PROMPT_WORDS)}`)
  }
  const sessionId = await discoverOne()
  await openSession(sessionId)
  const detail = await sessionDetail(sessionId)
  const prefix = detail?.piEntryNodeIdPrefix
  if (!detail || !prefix) throw new Error('The discovered Session has no node id prefix.')
  return { cli, sessionId, prefix }
}

async function userNodeIds(sessionId: SessionId) {
  const { SessionRepository } = await import('../../../ports/session-repository')
  const tree = await run(
    Effect.flatMap(SessionRepository, (repository) => repository.getTree(sessionId)),
  )
  return (tree?.nodes ?? []).filter((node) => node.role === 'user').map((node) => node.id)
}

describe('Operations on a discovered Pi session', () => {
  it('reads the context usage of a discovered session without writing its Pi file', async () => {
    const old = await writeVersion2PiSession(fixture.root, fixture.project)
    const sessionId = await discoverOne()
    await openSession(sessionId)
    const { getAgentContextUsage } = await import('../../../application/agent-session-service')

    await run(getAgentContextUsage({ sessionId, model: MODEL }))

    // Opening the file for a Run would migrate it to the current format and record the thinking
    // level, which would also change what `pi --resume` continues with.
    expect(await fs.readFile(old.file, 'utf8')).toBe(old.content)
  })

  it('runs in the same Pi file and keeps its node ids prefixed', async () => {
    const { cli, sessionId, prefix } = await discoveredSession()
    const { executeAgentRun } = await import('../../../application/agent-run-service')

    const result = await run(
      executeAgentRun({
        sessionId,
        runId: 'run-1',
        payload: { text: 'Third question', attachments: [] },
        model: MODEL,
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
    const { sessionId } = await discoveredSession()
    const [firstUser] = await userNodeIds(sessionId)
    const { navigateAgentSessionTree } = await import('../../../application/agent-session-service')

    const navigation = await run(
      navigateAgentSessionTree({
        sessionId,
        model: MODEL,
        targetNodeId: SessionNodeId(String(firstUser)),
      }),
    )

    expect(navigation).toMatchObject({ cancelled: false, editorText: 'First question' })
  })

  it('forks from a prefixed node into a new Session', async () => {
    const { sessionId } = await discoveredSession()
    const [, secondUser] = await userNodeIds(sessionId)
    const { forkAgentSessionToNewSession } = await import(
      '../../../application/agent-session-service'
    )

    const fork = await run(
      forkAgentSessionToNewSession({
        sessionId,
        model: MODEL,
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
          settings.update({ enabledModels: [MODEL], selectedModel: MODEL }),
        ),
      )
      const { sessionId } = await discoveredSession()
      const [, secondUser] = await userNodeIds(sessionId)
      const lastNode = (await sessionDetail(sessionId))?.messages.at(-1)?.id
      const { forkSession } = await import(
        '../../../application/host-ui-session-lifecycle-operations'
      )
      const target = position === 'before' ? String(secondUser) : String(lastNode)

      const fork = await run(forkSession([sessionId, MODEL, target], position))

      expect(fork.session.id).not.toBe(sessionId)
      expect(messageTexts(fork.session)).toEqual(texts)
    },
  )

  it('compacts and keeps the summary pointing at a prefixed node', async () => {
    const { sessionId, prefix } = await discoveredSession({ long: true })
    reply = 'Summary of the work so far'
    const { compactAgentSession } = await import('../../../application/agent-session-service')

    const compaction = await run(compactAgentSession({ sessionId, model: MODEL }))

    expect(compaction.summary).toContain('Summary of the work so far')
    expect(compaction.firstKeptEntryId.startsWith(prefix)).toBe(true)
  })
})
