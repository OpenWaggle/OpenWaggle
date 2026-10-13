import fs from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import path from 'node:path'
import { type SessionId, SupportedModelId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, vi } from 'vitest'
import {
  continuePiCliSession,
  createPiCliSession,
  discoverOne,
  openSession,
  type PiDiscoveryFixture,
  registerProjects,
  run,
  sessionDetail,
} from './pi-session-discovery.test-support'

/**
 * A local OpenAI-compatible endpoint configured in the temp Pi agent directory's `models.json`,
 * the way a `pi` user configures one, so discovered sessions can run real Runs in tests.
 */

export const FAKE_PROVIDER_MODEL = SupportedModelId('local/fake-model')
const DEFAULT_REPLY = 'Fake reply'

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

/**
 * Registers the endpoint for each test; `setReply` changes what it answers until the test ends.
 * `reasoningModels` are offered too, with every thinking level; `requests` holds the bodies the
 * endpoint received.
 */
export function setUpFakePiProvider(
  fixture: PiDiscoveryFixture,
  options: { readonly reasoningModels?: readonly string[] } = {},
) {
  let server: Server | undefined
  let reply = DEFAULT_REPLY
  const requests: Record<string, unknown>[] = []

  beforeEach(async () => {
    // MCP and skill discovery read the home directory; keep the user's own out of the test.
    vi.stubEnv('HOME', path.join(fixture.root, 'home'))
    server = createServer((request, response) => {
      const body: Buffer[] = []
      request.on('data', (data: Buffer) => body.push(data))
      request.on('end', () => {
        const parsed: unknown = JSON.parse(Buffer.concat(body).toString('utf8') || '{}')
        if (parsed && typeof parsed === 'object') requests.push({ ...parsed })
        response.writeHead(200, { 'content-type': 'text/event-stream' })
        response.write(chunk({ role: 'assistant', content: reply }, null))
        response.write(chunk({}, 'stop'))
        response.end('data: [DONE]\n\n')
      })
    })
    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('The fake endpoint has no port.')
    const baseUrl = `http://127.0.0.1:${String((address satisfies AddressInfo).port)}/v1`
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
            models: [
              { id: 'fake-model', contextWindow: 100_000, maxTokens: 1_000 },
              ...(options.reasoningModels ?? []).map((id) => ({
                id,
                reasoning: true,
                contextWindow: 100_000,
                maxTokens: 1_000,
              })),
            ],
          },
        },
      }),
    )
    await registerProjects([fixture.project])
  })

  afterEach(async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()))
    server = undefined
    reply = DEFAULT_REPLY
    requests.length = 0
  })

  return {
    requests,
    setReply(text: string) {
      reply = text
    },
  }
}

/** Long enough for compaction to have earlier turns to summarize. */
const LONG_TURNS = 3
const LONG_PROMPT_WORDS = 15_000

/** A discovered session with two exchanges, opened once so it is projected. */
export async function discoveredSession(
  fixture: PiDiscoveryFixture,
  options: { readonly long?: boolean; readonly cwd?: string } = {},
) {
  const cli = createPiCliSession(options.cwd ?? fixture.project, 'First question')
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

export async function userNodeIds(sessionId: SessionId) {
  const { SessionRepository } = await import('../../../ports/session-repository')
  const tree = await run(
    Effect.flatMap(SessionRepository, (repository) => repository.getTree(sessionId)),
  )
  return (tree?.nodes ?? []).filter((node) => node.role === 'user').map((node) => node.id)
}
