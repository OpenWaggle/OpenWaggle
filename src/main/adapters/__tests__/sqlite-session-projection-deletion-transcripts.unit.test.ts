import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { SessionId } from '@shared/types/brand'
import { fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NoopActionRunServiceLayer } from '../../application/__tests__/action-run-service-test-layer'
import { NoopWorkspacePreparationLayer } from '../../application/__tests__/workspace-preparation-test-layer'
import {
  SessionTranscriptFiles,
  SessionTranscriptFilesError,
  type SessionTranscriptLocation,
} from '../../ports/session-transcript-files'
import { SessionWorkspaceResourceRepository } from '../../ports/session-workspace-resource-repository'
import type { SessionDeletionRecord } from '../../store/session-details/session-deletion-journal'

const SESSION_ID = SessionId('session-managed')
const WORKTREE_PATH = '/project/.worktrees/session-managed'

interface StoredSession {
  readonly id: SessionId
  readonly projectPath: string
  readonly worktreePath: string | null
  readonly piSessionId?: string
  readonly piSessionFile?: string
}

function record(phase: SessionDeletionRecord['phase'], piSessionFile: string | null) {
  return {
    phase,
    resumed: true,
    piSessionFile,
    stagedPiSessionFile: piSessionFile ? `${piSessionFile}.staged.delete` : null,
    projectPath: '/project',
    worktreeProjectPath: '/project',
    worktreePath: WORKTREE_PATH,
    checkpointRefs: [],
  } satisfies SessionDeletionRecord
}

const mocks = vi.hoisted(() => ({
  getSessionDetail: vi.fn(async (): Promise<StoredSession | null> => null),
  getSessionDeletion: vi.fn(async (): Promise<SessionDeletionRecord | null> => null),
  prepareSessionDeletion: vi.fn(),
  commitSessionDeletion: vi.fn(),
  prepareSessionPiFileCleanup: vi.fn(),
  markSessionPiFileCleanupComplete: vi.fn(async () => undefined),
  abandonSessionDeletion: vi.fn(async () => undefined),
  listPendingSessionDeletions: vi.fn(async (): Promise<SessionId[]> => []),
  listTranscriptFiles: vi.fn(
    (_location: SessionTranscriptLocation): readonly string[] | Error => [],
  ),
}))

vi.mock('../../store/session-details', () => ({
  getSessionDetail: mocks.getSessionDetail,
  getSessionDeletion: mocks.getSessionDeletion,
  prepareSessionDeletion: mocks.prepareSessionDeletion,
  commitSessionDeletion: mocks.commitSessionDeletion,
  prepareSessionPiFileCleanup: mocks.prepareSessionPiFileCleanup,
  markSessionPiFileCleanupComplete: mocks.markSessionPiFileCleanupComplete,
  abandonSessionDeletion: mocks.abandonSessionDeletion,
  listPendingSessionDeletions: mocks.listPendingSessionDeletions,
  markSessionDeletionExternalCleanupComplete: vi.fn(async () => undefined),
  prepareSessionCheckpointRefCleanup: vi.fn(async () => undefined),
  listSessionWorktreeRefs: vi.fn(async () => []),
  clearSessionWorktree: vi.fn(async () => undefined),
  getBoundWorkspaceResource: vi.fn(async () => null),
}))
vi.mock('../../store/turn-checkpoints', () => ({}))
vi.mock('../../store/pinned-sessions', () => ({}))
vi.mock('../git/turn-checkpoint-refs', () => ({
  deleteSessionTurnCheckpointRefs: vi.fn(async () => []),
  restoreSessionTurnCheckpointRefs: vi.fn(async () => undefined),
}))
vi.mock('../../services/git/session-worktree-prune', () => ({
  pruneSessionWorktree: vi.fn(async () => ({ status: 'ready-for-deletion' })),
}))

import { SessionProjectionRepository } from '../../ports/session-projection-repository'
import { SqliteSessionProjectionRepositoryLive } from '../sqlite-session-projection-repository'

const transcriptFiles = SessionTranscriptFiles.of({
  listTranscriptFiles: (location) => {
    const files = mocks.listTranscriptFiles(location)
    return files instanceof Error
      ? Effect.fail(new SessionTranscriptFilesError({ cause: files }))
      : Effect.succeed(files)
  },
})

function runRepository(
  operation: (
    repository: typeof SessionProjectionRepository.Service,
  ) => Effect.Effect<void, unknown>,
) {
  return Effect.runPromise(
    Effect.gen(function* () {
      yield* operation(yield* SessionProjectionRepository)
    }).pipe(
      Effect.provide(SqliteSessionProjectionRepositoryLive),
      Effect.provide(NoopActionRunServiceLayer),
      Effect.provide(NoopWorkspacePreparationLayer),
      Effect.provideService(SessionWorkspaceResourceRepository, fromPartial({})),
      Effect.provideService(SessionTranscriptFiles, transcriptFiles),
    ),
  )
}

const deleteSession = () => runRepository((repository) => repository.delete(SESSION_ID))
const recoverPendingDeletions = () =>
  runRepository((repository) => repository.recoverPendingDeletions?.() ?? Effect.void)

let root = ''

async function writeFile(name: string) {
  const file = path.join(root, name)
  await fs.writeFile(file, '{"type":"session"}\n', 'utf8')
  return file
}

/** Recovery of a deletion journaled at `phase`, after the Session row was deleted. */
function journaledAfterRowDeletion(deletion: SessionDeletionRecord) {
  mocks.listPendingSessionDeletions.mockResolvedValueOnce([SESSION_ID])
  mocks.getSessionDetail.mockResolvedValue(null)
  mocks.getSessionDeletion.mockResolvedValueOnce(deletion)
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'ow-session-delete-copies-'))
  for (const mock of Object.values(mocks)) mock.mockReset()
  mocks.getSessionDetail.mockResolvedValue({
    id: SESSION_ID,
    projectPath: '/project',
    worktreePath: null,
  })
  mocks.listTranscriptFiles.mockReturnValue([])
  mocks.prepareSessionDeletion.mockImplementation(async (_id: SessionId, file?: string | null) =>
    record('prepared', file ?? null),
  )
  mocks.commitSessionDeletion.mockImplementation(async () =>
    record('durable-delete-complete', null),
  )
  mocks.prepareSessionPiFileCleanup.mockImplementation(
    async (_id: SessionId, file: string | null) => record('pi-file-cleanup-pending', file),
  )
})

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

describe('Session deletion of transcript copies the runtime would rediscover', () => {
  it('removes every file of the transcript, not only the recorded one', async () => {
    const recorded = await writeFile('2026-10-04T18-41-20-000Z_pi-session.jsonl')
    const firstRun = await writeFile('2026-10-04T18-41-34-000Z_pi-session.jsonl')
    const abandoned = await writeFile('2026-10-04T18-48-47-000Z_pi-session.jsonl')
    const other = await writeFile('2026-10-04T18-41-34-000Z_other-pi-session.jsonl')
    mocks.commitSessionDeletion.mockResolvedValueOnce(record('durable-delete-complete', recorded))
    mocks.listTranscriptFiles.mockReturnValue([firstRun, abandoned])

    await expect(deleteSession()).resolves.toBeUndefined()

    expect(mocks.listTranscriptFiles).toHaveBeenCalledWith({
      transcriptFile: recorded,
      projectPath: '/project',
      worktreePath: WORKTREE_PATH,
    })
    await expect(fs.stat(recorded)).rejects.toThrow()
    await expect(fs.stat(firstRun)).rejects.toThrow()
    await expect(fs.stat(abandoned)).rejects.toThrow()
    await expect(fs.stat(other)).resolves.toBeDefined()
    expect(mocks.markSessionPiFileCleanupComplete).toHaveBeenCalledWith(SESSION_ID)
  })

  it('removes the copies when recovery resumes an interrupted Pi file cleanup', async () => {
    const recorded = path.join(root, '2026-10-04T18-41-20-000Z_pi-session.jsonl')
    const firstRun = await writeFile('2026-10-04T18-41-34-000Z_pi-session.jsonl')
    journaledAfterRowDeletion(record('pi-file-cleanup-pending', recorded))
    mocks.listTranscriptFiles.mockReturnValue([firstRun])

    await expect(recoverPendingDeletions()).resolves.toBeUndefined()

    await expect(fs.stat(firstRun)).rejects.toThrow()
    expect(mocks.prepareSessionPiFileCleanup).not.toHaveBeenCalled()
    expect(mocks.abandonSessionDeletion).toHaveBeenCalledWith(SESSION_ID)
  })

  it('keeps the deletion journaled when the copies cannot be listed', async () => {
    const recorded = await writeFile('2026-10-04T18-41-20-000Z_pi-session.jsonl')
    journaledAfterRowDeletion(record('pi-file-cleanup-pending', recorded))
    mocks.listTranscriptFiles.mockReturnValue(new Error('session directory unreadable'))

    await expect(recoverPendingDeletions()).resolves.toBeUndefined()

    expect(mocks.markSessionPiFileCleanupComplete).not.toHaveBeenCalled()
    expect(mocks.abandonSessionDeletion).not.toHaveBeenCalled()
  })

  it('journals a rediscovered transcript file for a Session that recorded none', async () => {
    mocks.getSessionDetail.mockResolvedValue({
      id: SESSION_ID,
      projectPath: '/project',
      worktreePath: WORKTREE_PATH,
      piSessionId: 'pi-session',
    })
    const newest = path.join(root, '2026-10-04T18-48-47-000Z_pi-session.jsonl')
    const older = path.join(root, '2026-10-04T18-41-34-000Z_pi-session.jsonl')
    mocks.listTranscriptFiles.mockReturnValue([newest, older])

    await expect(deleteSession()).resolves.toBeUndefined()

    expect(mocks.listTranscriptFiles).toHaveBeenCalledWith({
      transcriptId: 'pi-session',
      transcriptFile: null,
      projectPath: '/project',
      worktreePath: WORKTREE_PATH,
    })
    expect(mocks.prepareSessionDeletion).toHaveBeenCalledWith(SESSION_ID, newest)
  })

  it('journals the recorded transcript file without searching for another', async () => {
    const recorded = '/sessions/2026-10-04T18-41-20-000Z_pi-session.jsonl'
    mocks.getSessionDetail.mockResolvedValue({
      id: SESSION_ID,
      projectPath: '/project',
      worktreePath: null,
      piSessionId: 'pi-session',
      piSessionFile: recorded,
    })

    await expect(deleteSession()).resolves.toBeUndefined()

    expect(mocks.prepareSessionDeletion).toHaveBeenCalledWith(SESSION_ID, recorded)
    expect(mocks.listTranscriptFiles).not.toHaveBeenCalledWith(
      expect.objectContaining({ transcriptId: 'pi-session' }),
    )
  })
})
