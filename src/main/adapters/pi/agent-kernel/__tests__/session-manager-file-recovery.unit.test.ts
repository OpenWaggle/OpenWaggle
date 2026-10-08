import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { SessionManager } from '@earendil-works/pi-coding-agent'
import type { SessionDetail } from '@shared/types/session'
import { fromPartial } from '@total-typescript/shoehorn'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSessionManagerForSession, piSessionDirectoryFor } from '../session-manager'

const USAGE = {
  input: 1,
  output: 1,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 2,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
}

function appendTurn(sessionManager: SessionManager, text: string, timestamp: number) {
  sessionManager.appendMessage({ role: 'user', content: text, timestamp })
  return sessionManager.appendMessage({
    role: 'assistant',
    content: [{ type: 'text', text: `${text} answer` }],
    api: 'openai-responses',
    provider: 'provider',
    model: 'model',
    usage: USAGE,
    stopReason: 'stop',
    timestamp: timestamp + 1,
  })
}

let root = ''
let projectPath = ''
let worktreePath = ''

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'ow-pi-file-recovery-'))
  projectPath = path.join(root, 'project')
  worktreePath = path.join(root, 'worktree')
  await fs.mkdir(projectPath)
  await fs.mkdir(worktreePath)
  vi.stubEnv('PI_CODING_AGENT_DIR', path.join(root, 'agent'))
})

afterEach(async () => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  await fs.rm(root, { recursive: true, force: true })
})

/**
 * The Session as preparation records it: Pi session id and the file of a manager created in the
 * opened checkout. Pi writes a file only on the first assistant message, so that file never exists.
 */
function preparedSession(): SessionDetail {
  const prepared = SessionManager.create(projectPath)
  return fromPartial<SessionDetail>({
    messages: [],
    piSessionId: prepared.getSessionId(),
    piSessionFile: prepared.getSessionFile(),
  })
}

describe('createSessionManagerForSession file recovery', () => {
  it('reopens the transcript a first run wrote when the recorded file was never written', () => {
    const session = preparedSession()
    expect(session.piSessionFile && path.dirname(session.piSessionFile)).not.toBe(
      SessionManager.create(worktreePath).getSessionDir(),
    )

    // The first run of a worktree Session writes its transcript in the worktree's Pi directory.
    const firstRun = createSessionManagerForSession(session, worktreePath)
    const head = appendTurn(firstRun, 'first', 1)
    expect(firstRun.getSessionFile()).not.toBe(session.piSessionFile)

    // The Host stops before the run's snapshot records the new file; the next run reopens.
    const resumed = createSessionManagerForSession(session, worktreePath)

    expect(resumed.getSessionId()).toBe(session.piSessionId)
    expect(resumed.getSessionFile()).toBe(firstRun.getSessionFile())
    expect(resumed.getLeafId()).toBe(head)
    expect(resumed.getEntries().map((entry) => entry.type)).toEqual(['message', 'message'])
  })

  it('finds a transcript written next to the recorded path under another name', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-04T18:41:20.000Z'))
    const session = preparedSession()
    // Pi names a file by the time its manager was created, so a later run writes another name.
    vi.setSystemTime(new Date('2026-10-04T18:41:34.000Z'))
    const firstRun = createSessionManagerForSession(session, projectPath)
    const head = appendTurn(firstRun, 'first', 1)

    expect(firstRun.getSessionFile()).not.toBe(session.piSessionFile)
    vi.setSystemTime(new Date('2026-10-04T18:48:47.000Z'))

    const resumed = createSessionManagerForSession(session, projectPath)

    expect(resumed.getSessionFile()).toBe(firstRun.getSessionFile())
    expect(resumed.getLeafId()).toBe(head)
  })

  it('finds the transcript after the Session moved from its worktree to the checkout', () => {
    const session = fromPartial<SessionDetail>({
      ...preparedSession(),
      projectPath,
      worktreePath,
    })
    const firstRun = createSessionManagerForSession(session, worktreePath)
    const head = appendTurn(firstRun, 'first', 1)

    // Switched to work locally before the first run's snapshot recorded its file.
    const resumed = createSessionManagerForSession(session, projectPath)

    expect(resumed.getSessionFile()).toBe(firstRun.getSessionFile())
    expect(resumed.getLeafId()).toBe(head)
  })

  it('prefers the newest file when abandoned copies share the Pi session id', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-04T18:41:20.000Z'))
    const session = preparedSession()
    vi.setSystemTime(new Date('2026-10-04T18:41:34.000Z'))
    const abandoned = createSessionManagerForSession(session, worktreePath)
    appendTurn(abandoned, 'abandoned', 1)
    vi.setSystemTime(new Date('2026-10-04T18:48:47.000Z'))
    const current = SessionManager.create(worktreePath)
    current.newSession({ id: session.piSessionId ?? '' })
    const head = appendTurn(current, 'current', 2)
    const abandonedFile = abandoned.getSessionFile() ?? ''
    await fs.utimes(abandonedFile, new Date(0), new Date(0))

    const resumed = createSessionManagerForSession(session, worktreePath)

    expect(resumed.getSessionFile()).toBe(current.getSessionFile())
    expect(resumed.getLeafId()).toBe(head)
  })

  it('starts a fresh transcript with the Session Pi id when no file exists', () => {
    const session = preparedSession()

    const fresh = createSessionManagerForSession(session, worktreePath)

    expect(fresh.getSessionId()).toBe(session.piSessionId)
    expect(fresh.getEntries()).toEqual([])
  })

  it('ignores files of other Pi sessions in the same directory', () => {
    const other = SessionManager.create(worktreePath)
    appendTurn(other, 'other', 1)
    const session = preparedSession()

    const fresh = createSessionManagerForSession(session, worktreePath)

    expect(fresh.getEntries()).toEqual([])
  })
})

describe('piSessionDirectoryFor', () => {
  it('matches the directory Pi itself uses for a working directory', () => {
    for (const cwd of [
      projectPath,
      worktreePath,
      path.join(root, 'with space'),
      path.join(root, 'a:b'),
    ]) {
      expect(piSessionDirectoryFor(cwd)).toBe(SessionManager.create(cwd).getSessionDir())
    }
  })
})
