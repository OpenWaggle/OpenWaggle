import { utimesSync } from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { AssistantMessage } from '@earendil-works/pi-ai'
import { SessionManager } from '@earendil-works/pi-coding-agent'
import * as SqlClient from '@effect/sql/SqlClient'
import { SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, expect, vi } from 'vitest'
import type { AppServices } from '../../../runtime'

export interface PiDiscoveryFixture {
  root: string
  project: string
}

/**
 * A temporary user-data directory and Pi agent directory per test, with a project inside them.
 * `state` is the hoisted object the test's `electron` mock reads the user-data path from.
 */
export function setUpPiDiscoveryFixture(state: { userDataDir: string }): PiDiscoveryFixture {
  const fixture: PiDiscoveryFixture = { root: '', project: '' }
  beforeEach(async () => {
    fixture.root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'ow-pi-discovery-')))
    state.userDataDir = path.join(fixture.root, 'user-data')
    fixture.project = path.join(fixture.root, 'projects', 'app')
    await fs.mkdir(path.join(fixture.project, 'packages', 'core'), { recursive: true })
    vi.stubEnv('PI_CODING_AGENT_DIR', path.join(fixture.root, 'pi-agent'))
    const { resetAppRuntimeForTests } = await import('../../../runtime')
    await resetAppRuntimeForTests()
  })
  afterEach(async () => {
    const { resetAppRuntimeForTests } = await import('../../../runtime')
    await resetAppRuntimeForTests()
    vi.unstubAllEnvs()
    await fs.rm(fixture.root, { recursive: true, force: true })
  })
  return fixture
}

/** The model that answered a CLI exchange. */
export interface PiCliResponder {
  readonly provider: string
  readonly model: string
}

const TEST_RESPONDER: PiCliResponder = { provider: 'test', model: 'test-model' }

function assistantReply(text: string, responder = TEST_RESPONDER): AssistantMessage {
  return {
    role: 'assistant',
    content: [{ type: 'text', text }],
    api: 'openai-completions',
    provider: responder.provider,
    model: responder.model,
    usage: {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: 'stop',
    timestamp: Date.now(),
  }
}

/** How long ago the helpers date a CLI write: past discovery's quiet period for new files. */
const CLI_WRITE_AGE_MS = 60_000

/** Dates a Pi file's last write a minute back, as if the CLI wrote it a while ago. */
export function agePiFile(file: string) {
  const past = new Date(Date.now() - CLI_WRITE_AGE_MS)
  utimesSync(file, past, past)
}

/** Runs SQL against the app database, for fixtures and checks the ports do not expose. */
export function runSql<A>(query: (sql: SqlClient.SqlClient) => Effect.Effect<A, unknown>) {
  return import('../../../store/store-runtime').then(({ runStoreEffect }) =>
    runStoreEffect(Effect.flatMap(SqlClient.SqlClient, query)),
  )
}

/** What the `pi` CLI leaves behind after one exchange in `cwd`. */
export function createPiCliSession(cwd: string, prompt: string) {
  const sessionManager = SessionManager.create(cwd)
  sessionManager.appendMessage({
    role: 'user',
    content: [{ type: 'text', text: prompt }],
    timestamp: Date.now(),
  })
  sessionManager.appendMessage(assistantReply(`Answer to: ${prompt}`))
  const file = sessionManager.getSessionFile()
  if (!file) throw new Error('Pi did not create a session file.')
  agePiFile(file)
  return { id: sessionManager.getSessionId(), file }
}

/** The CLI continuing the same session, as `pi --resume` would. */
export function continuePiCliSession(file: string, prompt: string, responder?: PiCliResponder) {
  const sessionManager = SessionManager.open(file)
  sessionManager.appendMessage({
    role: 'user',
    content: [{ type: 'text', text: prompt }],
    timestamp: Date.now(),
  })
  sessionManager.appendMessage(assistantReply(`Answer to: ${prompt}`, responder))
  agePiFile(file)
}

export async function run<A, E>(effect: Effect.Effect<A, E, AppServices>) {
  const { runAppEffect } = await import('../../../runtime')
  return runAppEffect(effect)
}

export async function registerProjects(projectPaths: readonly string[]) {
  const { SettingsService } = await import('../../../services/settings-service')
  await run(
    Effect.flatMap(SettingsService, (settings) =>
      settings.update({ recentProjects: [...projectPaths] }),
    ),
  )
}

/** The Session Host's lifecycle create, which the Host entry passes to discovery. */
export async function lifecycleCreate() {
  const { createDiscoveredSessionWithLifecycle } = await import(
    '../../../application/pi-session-discovery-lifecycle'
  )
  return createDiscoveredSessionWithLifecycle
}

export async function discover(options: { readonly now?: number } = {}) {
  const { discoverPiSessions } = await import('../../../application/pi-session-discovery')
  const createSession = await lifecycleCreate()
  return run(discoverPiSessions({ ...options, createSession }))
}

/** The Session one discovery pass listed. */
export async function discoverOne() {
  const listed = await discover()
  expect(listed).toHaveLength(1)
  const [sessionId] = listed
  if (!sessionId) throw new Error('Discovery listed no Session.')
  return sessionId
}

export async function openSession(sessionId: string) {
  const { refreshPiSessionProjection } = await import(
    '../../../application/pi-session-projection-refresh'
  )
  return run(refreshPiSessionProjection(SessionId(sessionId), 'reader'))
}

export async function sessionDetail(sessionId: string) {
  const { SessionProjectionRepository } = await import(
    '../../../ports/session-projection-repository'
  )
  return run(
    Effect.flatMap(SessionProjectionRepository, (repository) =>
      repository.getOptional(SessionId(sessionId)),
    ),
  )
}

export function messageTexts(detail: Awaited<ReturnType<typeof sessionDetail>>) {
  return (detail?.messages ?? []).flatMap((message) =>
    message.parts.flatMap((part) => (part.type === 'text' ? [part.text] : [])),
  )
}

/** A session the `pi` CLI wrote in its previous file format, version 2. */
export async function writeVersion2PiSession(root: string, cwd: string) {
  const directory = path.join(
    root,
    'pi-agent',
    'sessions',
    `--${cwd.replace(/^[/\\]/, '').replace(/[/\\:]/g, '-')}--`,
  )
  await fs.mkdir(directory, { recursive: true })
  const file = path.join(directory, '2025-01-01T00-00-00-000Z_old-format.jsonl')
  const lines = [
    { type: 'session', version: 2, id: 'old-format', timestamp: '2025-01-01T00:00:00.000Z', cwd },
    {
      type: 'message',
      id: 'aaaa0001',
      parentId: null,
      timestamp: '2025-01-01T00:00:01.000Z',
      message: {
        role: 'user',
        content: [{ type: 'text', text: 'From an older pi' }],
        timestamp: 1,
      },
    },
  ]
  const content = `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`
  await fs.writeFile(file, content)
  agePiFile(file)
  return { file, content }
}
