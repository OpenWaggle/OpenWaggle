import { chmod, mkdir, mkdtemp, realpath, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { SessionId } from '@shared/types/brand'
import type { SessionDetail } from '@shared/types/session'
import { Effect } from 'effect'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { piSessionDirectoryFor } from '../agent-kernel/session-manager'
import { createPiSessionFiles } from '../pi-session-files'

/**
 * Which Pi file a Run of a created Session continues once its recorded file was deleted: a copy
 * under its Pi session id, wherever the Session may have filed one, even when its run directory
 * cannot be resolved; a new one when there is none. A folder that may hold a copy and cannot be
 * read leaves that unknown.
 */

const PI_SESSION_ID = 'pi-continued'
let root = ''
let lockedFolder = ''
const files = createPiSessionFiles()

function session(overrides: Partial<SessionDetail> = {}): SessionDetail {
  return {
    id: SessionId('session-continued'),
    title: 'Continued',
    projectPath: path.join(root, 'project'),
    piSessionId: PI_SESSION_ID,
    piSessionFile: path.join(root, 'recorded', `2026-01-01T00-00-00-000Z_${PI_SESSION_ID}.jsonl`),
    environmentMode: 'worktree',
    worktreePath: path.join(root, 'worktree-gone'),
    messages: [],
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

async function writeCopy(folder: string) {
  await mkdir(folder, { recursive: true })
  const copy = path.join(folder, `2026-01-02T00-00-00-000Z_${PI_SESSION_ID}.jsonl`)
  await writeFile(copy, `${JSON.stringify({ type: 'session', id: PI_SESSION_ID })}\n`)
  await utimes(copy, new Date(), new Date())
  return copy
}

beforeEach(async () => {
  root = await realpath(await mkdtemp(path.join(tmpdir(), 'ow-pi-continued-file-')))
  await mkdir(path.join(root, 'project'), { recursive: true })
  await mkdir(path.join(root, 'recorded'), { recursive: true })
  vi.stubEnv('PI_CODING_AGENT_DIR', path.join(root, 'agent'))
})

afterEach(async () => {
  if (lockedFolder) await chmod(lockedFolder, 0o700).catch(() => undefined)
  lockedFolder = ''
  vi.unstubAllEnvs()
  await rm(root, { recursive: true, force: true })
})

describe("A created Session's continued Pi file", () => {
  it('is a copy in its recorded folder when its worktree is gone', async () => {
    const copy = await writeCopy(path.join(root, 'recorded'))

    expect(await Effect.runPromise(files.continuedFile(session()))).toEqual({
      kind: 'file',
      file: copy,
    })
  })

  it("is a copy in its checkout's Pi folder when its worktree is gone", async () => {
    const copy = await writeCopy(piSessionDirectoryFor(path.join(root, 'project')))

    expect(await Effect.runPromise(files.continuedFile(session()))).toEqual({
      kind: 'file',
      file: copy,
    })
  })

  it('is new when no folder holds a copy', async () => {
    expect(await Effect.runPromise(files.continuedFile(session()))).toEqual({ kind: 'new' })
  })

  it.skipIf(process.getuid?.() === 0)(
    'is unknown while a folder that may hold a copy cannot be read',
    async () => {
      lockedFolder = piSessionDirectoryFor(path.join(root, 'project'))
      await writeCopy(lockedFolder)
      await chmod(lockedFolder, 0o000)

      expect(await Effect.runPromise(files.continuedFile(session()))).toEqual({
        kind: 'unsearchable',
        folder: lockedFolder,
      })
    },
  )
})
