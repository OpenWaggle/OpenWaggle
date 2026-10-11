import { existsSync, readFileSync } from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { SessionManager } from '@earendil-works/pi-coding-agent'
import type { SessionDetail } from '@shared/types/session'
import { fromPartial } from '@total-typescript/shoehorn'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createReadOnlySessionManagerForSession,
  createSessionManagerForSession,
} from '../session-manager'

const PRE_CREATED_PI_SESSION_ID = '0199b1c2-0000-7000-8000-00000000abcd'

let home = ''
let projectPath = ''

function session(fields: Partial<SessionDetail>): SessionDetail {
  return fromPartial<SessionDetail>({
    projectPath,
    environmentMode: 'local',
    messages: [],
    ...fields,
  })
}

function appendUserMessage(manager: SessionManager, text: string) {
  manager.appendMessage({ role: 'user', content: [{ type: 'text', text }], timestamp: Date.now() })
}

function fileHeaderId(sessionFile: string) {
  const [header] = readFileSync(sessionFile, 'utf8').trim().split('\n')
  const parsed: unknown = JSON.parse(header ?? '{}')
  return typeof parsed === 'object' && parsed !== null && 'id' in parsed ? parsed.id : undefined
}

beforeEach(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-pi-session-file-'))
  projectPath = path.join(home, 'project')
  await fs.mkdir(projectPath, { recursive: true })
  vi.stubEnv('HOME', home)
  vi.stubEnv('PI_CODING_AGENT_DIR', path.join(home, '.pi', 'agent'))
})

afterEach(async () => {
  vi.unstubAllEnvs()
  await fs.rm(home, { recursive: true, force: true })
})

describe('Pi session file creation (Pi 0.99+ writes the file at the first user message)', () => {
  it('keeps the pre-created Pi session id through setup entries and the first user message', () => {
    const manager = createSessionManagerForSession(
      session({ piSessionId: PRE_CREATED_PI_SESSION_ID }),
      projectPath,
    )
    manager.appendModelChange('openai', 'gpt-5.4')
    manager.appendThinkingLevelChange('high')
    const sessionFile = manager.getSessionFile()

    expect(manager.getSessionId()).toBe(PRE_CREATED_PI_SESSION_ID)
    expect(sessionFile).toBeDefined()
    expect(sessionFile && existsSync(sessionFile)).toBe(false)

    appendUserMessage(manager, 'Start the migration')

    expect(sessionFile && existsSync(sessionFile)).toBe(true)
    expect(sessionFile && fileHeaderId(sessionFile)).toBe(PRE_CREATED_PI_SESSION_ID)
  })

  it('reopens a Run cancelled before the first reply with its id and the user message', () => {
    const first = createSessionManagerForSession(
      session({ piSessionId: PRE_CREATED_PI_SESSION_ID }),
      projectPath,
    )
    first.appendModelChange('openai', 'gpt-5.4')
    appendUserMessage(first, 'Cancel me before the reply')
    const sessionFile = first.getSessionFile()

    const reopened = createSessionManagerForSession(
      session({ piSessionId: PRE_CREATED_PI_SESSION_ID, piSessionFile: sessionFile }),
      projectPath,
    )

    expect(reopened.getSessionId()).toBe(PRE_CREATED_PI_SESSION_ID)
    expect(reopened.getSessionFile()).toBe(sessionFile)
    expect(
      reopened
        .getEntries()
        .filter((entry) => entry.type === 'message')
        .map((entry) => entry.message.role),
    ).toEqual(['user'])
  })

  it('keeps the pre-created id when a Run ended before Pi wrote the recorded file', () => {
    const neverWritten = path.join(home, '.pi', 'agent', 'sessions', 'never-written.jsonl')

    const manager = createSessionManagerForSession(
      session({ piSessionId: PRE_CREATED_PI_SESSION_ID, piSessionFile: neverWritten }),
      projectPath,
    )
    appendUserMessage(manager, 'Try again')

    expect(manager.getSessionId()).toBe(PRE_CREATED_PI_SESSION_ID)
    const sessionFile = manager.getSessionFile()
    expect(sessionFile && fileHeaderId(sessionFile)).toBe(PRE_CREATED_PI_SESSION_ID)
  })

  it('starts the file recorded when the Session was created, under its recorded name', () => {
    // What preparation records: the name Pi gave the file it had not written yet.
    const recorded = path.join(
      home,
      'project',
      '.pi',
      'sessions',
      `2026-10-09T10-41-32-337Z_${PRE_CREATED_PI_SESSION_ID}.jsonl`,
    )

    const manager = createSessionManagerForSession(
      session({ piSessionId: PRE_CREATED_PI_SESSION_ID, piSessionFile: recorded }),
      projectPath,
    )
    appendUserMessage(manager, 'First message')

    expect(manager.getSessionFile()).toBe(recorded)
    expect(manager.getSessionId()).toBe(PRE_CREATED_PI_SESSION_ID)
    expect(fileHeaderId(recorded)).toBe(PRE_CREATED_PI_SESSION_ID)
    expect(readFileSync(recorded, 'utf8')).toContain('First message')
  })

  it("keeps a worktree Session's new file in the project's sessionDir before its worktree is known", async () => {
    // The first send creates the worktree, so the Session the Run gets has no worktree path yet.
    const worktree = path.join(home, '.openwaggle', 'worktrees', 'project', 'w1')
    for (const checkout of [projectPath, worktree]) {
      await fs.mkdir(path.join(checkout, '.pi'), { recursive: true })
      await fs.writeFile(
        path.join(checkout, '.pi', 'settings.json'),
        JSON.stringify({ sessionDir: '.pi/sessions' }),
      )
    }

    const manager = createSessionManagerForSession(
      session({ piSessionId: PRE_CREATED_PI_SESSION_ID, environmentMode: 'worktree' }),
      worktree,
    )

    expect(manager.getSessionDir()).toBe(path.join(projectPath, '.pi', 'sessions'))
  })
})

describe('A recorded Pi file that is missing after it was written', () => {
  const recordedFile = () =>
    path.join(
      projectPath,
      '.pi',
      'sessions',
      `2026-10-09T10-41-32-337Z_${PRE_CREATED_PI_SESSION_ID}.jsonl`,
    )

  const discovered: Partial<SessionDetail> = { piEntryNodeIdPrefix: 'pi:discovered:' }
  const createdWithEntries: Partial<SessionDetail> = {
    resumePosition: fromPartial({ piEntryCount: 2 }),
    messages: [fromPartial({ id: 'n1', role: 'user', parts: [] })],
  }
  const deletedSession = (fields: Partial<SessionDetail>) =>
    session({ piSessionId: PRE_CREATED_PI_SESSION_ID, piSessionFile: recordedFile(), ...fields })

  it("refuses a discovered Session's Run instead of starting its file again", async () => {
    await fs.mkdir(path.dirname(recordedFile()), { recursive: true })

    expect(() => createSessionManagerForSession(deletedSession(discovered), projectPath)).toThrow(
      /^This Session's Pi session file was deleted outside OpenWaggle/,
    )
    const readManager = await createReadOnlySessionManagerForSession(
      deletedSession(discovered),
      projectPath,
    )

    expect(readManager.isPersisted()).toBe(false)
    expect(existsSync(recordedFile())).toBe(false)
  })

  it('starts a new transcript for a created Session, not the recorded file again', async () => {
    await fs.mkdir(path.dirname(recordedFile()), { recursive: true })

    const runManager = createSessionManagerForSession(
      deletedSession(createdWithEntries),
      projectPath,
    )
    const readManager = await createReadOnlySessionManagerForSession(
      deletedSession(createdWithEntries),
      projectPath,
    )

    expect(runManager.getSessionFile()).not.toBe(recordedFile())
    expect(readManager.isPersisted()).toBe(false)
    expect(existsSync(recordedFile())).toBe(false)
  })

  it('refuses a discovered Session linked to a file out of reach as unavailable, not deleted', async () => {
    await fs.mkdir(path.dirname(recordedFile()), { recursive: true })
    await fs.symlink(path.join(home, 'unmounted', 'file.jsonl'), recordedFile())

    expect(() => createSessionManagerForSession(deletedSession(discovered), projectPath)).toThrow(
      /^This Session's Pi session file is unavailable \(.+\): it cannot be read/,
    )
  })

  it.skipIf(process.getuid?.() === 0)(
    'refuses a Session whose Pi file may not be read, rather than failing in Pi',
    async () => {
      await fs.mkdir(path.dirname(recordedFile()), { recursive: true })
      await fs.writeFile(recordedFile(), '{"type":"session"}\n')
      await fs.chmod(recordedFile(), 0o000)

      expect(() =>
        createSessionManagerForSession(deletedSession(createdWithEntries), projectPath),
      ).toThrow(/^This Session's Pi session file is unavailable \(.+\): it cannot be read/)
      await fs.chmod(recordedFile(), 0o600)
    },
  )

  it('refuses a created Session whose folder was in its own worktree, as any missing folder', () => {
    const worktree = path.join(home, '.openwaggle', 'worktrees', 'project', 'w1')
    const inWorktree = path.join(
      worktree,
      '.pi',
      'sessions',
      `2026-10-09T10-41-32-337Z_${PRE_CREATED_PI_SESSION_ID}.jsonl`,
    )
    const removed = session({
      piSessionId: PRE_CREATED_PI_SESSION_ID,
      piSessionFile: inWorktree,
      environmentMode: 'worktree',
      worktreePath: worktree,
      ...createdWithEntries,
    })

    expect(() => createSessionManagerForSession(removed, projectPath)).toThrow(
      /^This Session's Pi session file is unavailable .*its folder is missing/,
    )
    expect(existsSync(path.dirname(inWorktree))).toBe(false)
  })

  it.each<[string, Partial<SessionDetail>]>([
    ['a discovered Session', discovered],
    ['a created Session with entries', createdWithEntries],
  ])('refuses %s whose folder is missing, and creates no folder', async (_name, fields) => {
    expect(() => createSessionManagerForSession(deletedSession(fields), projectPath)).toThrow(
      /^This Session's Pi session file is unavailable .*its folder is missing/,
    )
    await createReadOnlySessionManagerForSession(deletedSession(fields), projectPath)

    expect(existsSync(path.dirname(recordedFile()))).toBe(false)
  })
})
