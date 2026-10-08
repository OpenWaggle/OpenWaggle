import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { SessionManager } from '@earendil-works/pi-coding-agent'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { piSessionIdOfFile } from '../agent-kernel/session-manager'
import { listPiSessionTranscriptFiles } from '../pi-session-transcript-files'

let root = ''
let projectPath = ''
let worktreePath = ''

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'ow-pi-transcript-files-'))
  projectPath = path.join(root, 'project')
  worktreePath = path.join(root, 'worktree')
  await fs.mkdir(projectPath)
  await fs.mkdir(worktreePath)
  vi.stubEnv('PI_CODING_AGENT_DIR', path.join(root, 'agent'))
})

afterEach(async () => {
  vi.unstubAllEnvs()
  await fs.rm(root, { recursive: true, force: true })
})

/** Writes a Pi file named the way Pi names it, `<creation time>_<Pi session id>.jsonl`. */
async function writePiFile(cwd: string, piSessionId: string, createdAt: string) {
  const directory = SessionManager.create(cwd).getSessionDir()
  const file = path.join(directory, `${createdAt}_${piSessionId}.jsonl`)
  await fs.writeFile(file, '{"type":"session"}\n', 'utf8')
  return file
}

describe('listPiSessionTranscriptFiles', () => {
  it('finds every file of the recorded transcript in the checkout, worktree and recorded directories', async () => {
    const prepared = SessionManager.create(projectPath)
    const piSessionId = prepared.getSessionId()
    const recordedDirectory = path.join(root, 'recorded')
    await fs.mkdir(recordedDirectory)
    const recorded = path.join(recordedDirectory, `2026-10-04T18-41-20-000Z_${piSessionId}.jsonl`)
    await fs.writeFile(recorded, '{"type":"session"}\n', 'utf8')
    const checkoutCopy = await writePiFile(projectPath, piSessionId, '2026-10-04T18-41-34-000Z')
    const worktreeCopy = await writePiFile(worktreePath, piSessionId, '2026-10-04T18-48-47-000Z')
    const otherCheckout = await writePiFile(
      projectPath,
      'other-pi-session',
      '2026-10-04T18-41-34-000Z',
    )
    const otherWorktree = await writePiFile(
      worktreePath,
      'other-pi-session',
      '2026-10-04T18-48-47-000Z',
    )

    const files = listPiSessionTranscriptFiles({
      transcriptFile: recorded,
      projectPath,
      worktreePath,
    })

    expect([...files].sort()).toEqual([recorded, checkoutCopy, worktreeCopy].sort())
    expect(files).not.toContain(otherCheckout)
    expect(files).not.toContain(otherWorktree)
  })

  it('reads the transcript id from a recorded file that was never written', async () => {
    const prepared = SessionManager.create(projectPath)
    const firstRunCopy = await writePiFile(
      worktreePath,
      prepared.getSessionId(),
      '2026-10-04T18-41-34-000Z',
    )

    expect(
      listPiSessionTranscriptFiles({
        transcriptFile: prepared.getSessionFile() ?? null,
        projectPath,
        worktreePath,
      }),
    ).toEqual([firstRunCopy])
  })

  it('uses an explicit transcript id when no file was recorded', async () => {
    const copy = await writePiFile(projectPath, 'pi-session-explicit', '2026-10-04T18-41-34-000Z')
    await writePiFile(projectPath, 'pi-session-other', '2026-10-04T18-41-34-000Z')

    expect(
      listPiSessionTranscriptFiles({
        transcriptId: 'pi-session-explicit',
        transcriptFile: null,
        projectPath,
        worktreePath: null,
      }),
    ).toEqual([copy])
  })

  it('leaves a file whose Pi session id only ends with the Session one', async () => {
    const copy = await writePiFile(projectPath, 'pi-session-x', '2026-10-04T18-41-34-000Z')
    await writePiFile(projectPath, 'review_pi-session-x', '2026-10-04T18-48-47-000Z')

    expect(
      listPiSessionTranscriptFiles({
        transcriptId: 'pi-session-x',
        transcriptFile: null,
        projectPath,
        worktreePath: null,
      }),
    ).toEqual([copy])
  })

  it('finds nothing when the recorded file does not name a Pi session', async () => {
    await writePiFile(projectPath, 'pi-session', '2026-10-04T18-41-34-000Z')

    expect(
      listPiSessionTranscriptFiles({
        transcriptFile: path.join(root, 'custom.jsonl'),
        projectPath,
        worktreePath: null,
      }),
    ).toEqual([])
  })
})

describe('piSessionIdOfFile', () => {
  it('reads the id Pi names a session file for', () => {
    const sessionManager = SessionManager.create(projectPath)

    expect(piSessionIdOfFile(sessionManager.getSessionFile() ?? '')).toBe(
      sessionManager.getSessionId(),
    )
    expect(piSessionIdOfFile('/sessions/custom.jsonl')).toBeUndefined()
    expect(piSessionIdOfFile('/sessions/2026_id.json')).toBeUndefined()
    expect(piSessionIdOfFile('/sessions/2026_.jsonl')).toBeUndefined()
  })
})
