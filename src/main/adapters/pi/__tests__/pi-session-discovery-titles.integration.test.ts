import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  agePiFile,
  discover,
  discoverOne,
  registerProjects,
  runSql,
  setUpPiDiscoveryFixture,
} from './pi-session-discovery.test-support'

/**
 * Titles of discovered Pi sessions (ADR 0051): without a Pi `/name`, a discovered session is
 * titled like a Session started in OpenWaggle (ADR 0043), from its first user message even when
 * Pi's recorded system prompt pushes it past the first 64 KiB of the file.
 */

interface TitleRequest {
  readonly sessionId: string
  readonly text: string
  readonly model: string | null
}

const { state, getPathMock, titleRequests } = vi.hoisted(() => {
  const requests: TitleRequest[] = []
  return { state: { userDataDir: '' }, getPathMock: vi.fn(() => ''), titleRequests: requests }
})

getPathMock.mockImplementation(() => state.userDataDir)

vi.mock('electron', () => ({
  app: { getPath: getPathMock },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (value: string) => Buffer.from(value, 'utf8'),
    decryptString: (value: Buffer) => value.toString('utf8'),
  },
}))

vi.mock('../../../application/session-title-scheduler', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../application/session-title-scheduler')>()),
  requestInitialSessionTitle: (input: {
    sessionId: string
    text: string
    model?: string | null
  }) => {
    titleRequests.push({ sessionId: input.sessionId, text: input.text, model: input.model ?? null })
  },
}))

const fixture = setUpPiDiscoveryFixture(state)

const DAY_MS = 24 * 60 * 60 * 1000
/** Larger than discovery's 64 KiB prefix, as Pi's recorded system prompt with tool schemas is. */
const SYSTEM_PROMPT_BYTES = 120 * 1024

interface PiFileEntries {
  readonly id: string
  readonly entries: readonly unknown[]
}

function piSessionDirectory(cwd: string) {
  return path.join(
    fixture.root,
    'pi-agent',
    'sessions',
    `--${cwd.replace(/^[/\\]/, '').replace(/[/\\:]/g, '-')}--`,
  )
}

async function writePiFile({ id, entries }: PiFileEntries) {
  const directory = piSessionDirectory(fixture.project)
  await fs.mkdir(directory, { recursive: true })
  const file = path.join(directory, `2026-10-16T11-32-05-602Z_${id}.jsonl`)
  const header = {
    type: 'session',
    version: 3,
    id,
    timestamp: '2026-10-16T11:32:05.602Z',
    cwd: fixture.project,
  }
  await fs.writeFile(
    file,
    `${[header, ...entries].map((line) => JSON.stringify(line)).join('\n')}\n`,
  )
  agePiFile(file)
  return file
}

async function appendEntries(file: string, entries: readonly unknown[]) {
  await fs.appendFile(file, `${entries.map((line) => JSON.stringify(line)).join('\n')}\n`)
  agePiFile(file)
}

const modelChange = {
  type: 'model_change',
  id: 'm1',
  parentId: null,
  timestamp: '2026-10-16T11:32:05.890Z',
  provider: 'amazon-bedrock',
  modelId: 'eu.anthropic.claude-opus-5',
}

const systemPrompt = {
  type: 'message',
  id: 's1',
  parentId: 'm1',
  timestamp: '2026-10-16T11:32:06.000Z',
  message: { role: 'system', content: '', sections: { preamble: 'x'.repeat(SYSTEM_PROMPT_BYTES) } },
}

function userMessage(id: string, parentId: string, text: string, at: number) {
  return {
    type: 'message',
    id,
    parentId,
    timestamp: new Date(at).toISOString(),
    message: { role: 'user', content: [{ type: 'text', text }], timestamp: at },
  }
}

async function titleRow(sessionId: string) {
  const rows = await runSql(
    (sql) => sql<{ readonly title: string; readonly title_source: string }>`
      SELECT title, title_source FROM sessions WHERE id = ${sessionId}
    `,
  )
  return rows[0]
}

describe('Titles of discovered Pi sessions', () => {
  it('titles a session from a first message past the system prompt and asks for a title', async () => {
    titleRequests.length = 0
    await registerProjects([fixture.project])
    await writePiFile({
      id: 'after-system-prompt',
      entries: [
        modelChange,
        systemPrompt,
        userMessage('u1', 's1', 'Reply with the session id the hooks gave you', Date.now()),
      ],
    })

    const sessionId = await discoverOne()

    expect(await titleRow(sessionId)).toEqual({
      title: 'Reply with the session id the hooks gave you',
      title_source: 'provisional',
    })
    expect(titleRequests).toEqual([
      {
        sessionId,
        text: 'Reply with the session id the hooks gave you',
        model: 'amazon-bedrock/eu.anthropic.claude-opus-5',
      },
    ])
    // A later pass does not ask again.
    await discover()
    expect(titleRequests).toHaveLength(1)
  })

  it('keeps the first-message title of a session started more than a day ago', async () => {
    titleRequests.length = 0
    await registerProjects([fixture.project])
    await writePiFile({
      id: 'old-session',
      entries: [
        modelChange,
        userMessage('u1', 'm1', 'Fix the old parser', Date.now() - 2 * DAY_MS),
      ],
    })

    const sessionId = await discoverOne()

    expect(await titleRow(sessionId)).toEqual({
      title: 'Fix the old parser',
      title_source: 'generated',
    })
    expect(titleRequests).toEqual([])
  })

  it('titles a session listed as "New session" once its file has a first message', async () => {
    titleRequests.length = 0
    await registerProjects([fixture.project])
    const file = await writePiFile({ id: 'written-later', entries: [modelChange, systemPrompt] })
    const sessionId = await discoverOne()
    expect(await titleRow(sessionId)).toEqual({ title: 'New session', title_source: 'default' })

    await appendEntries(file, [userMessage('u1', 's1', 'Add the oxlint reference', Date.now())])
    await discover()

    expect(await titleRow(sessionId)).toEqual({
      title: 'Add the oxlint reference',
      title_source: 'provisional',
    })
    expect(titleRequests.map((request) => request.text)).toEqual(['Add the oxlint reference'])
  })

  it('takes a later Pi /name for a session still titled "New session"', async () => {
    titleRequests.length = 0
    await registerProjects([fixture.project])
    const file = await writePiFile({ id: 'named-later', entries: [modelChange] })
    const sessionId = await discoverOne()

    await appendEntries(file, [
      { type: 'session_info', id: 'n1', parentId: 'm1', timestamp: '', name: 'Hooks QA' },
    ])
    await discover()

    expect(await titleRow(sessionId)).toEqual({ title: 'Hooks QA', title_source: 'generated' })
    expect(titleRequests).toEqual([])
  })
})
