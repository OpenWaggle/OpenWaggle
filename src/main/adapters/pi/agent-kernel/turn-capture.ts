import { copyFile, mkdtemp, rm, stat, utimes } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { SessionId } from '@shared/types/brand'
import type { SessionDetail } from '@shared/types/session'
import { turnCheckpointRef } from '@shared/utils/turn-checkpoint-ref'
import { parseTurnDiffFilesFromUnifiedDiff } from '@shared/utils/turn-diff-parse'
import { createLogger } from '../../../logger'
import { recordDelegationTurnWrites } from '../../../store/delegation-write-observer'
import {
  getLatestSnapshotRef,
  pruneTurnCheckpoints,
  recordTurnCheckpoint,
} from '../../../store/turn-checkpoints'
import { DIFF_GIT_MAX_BUFFER, runGit } from '../../git/run-git'
import { isPathInsideProject, physicalPath } from '../pi-session-project-paths'

const logger = createLogger('turn-capture')
const MAX_CHECKPOINTS_PER_SESSION = 100

/**
 * Best-effort per-turn checkpoint capture (WS7). Snapshots the worktree into a
 * scratch index (so untracked files ARE included) without touching the real
 * index/working tree, anchors the snapshot commit under
 * `refs/openwaggle/turn-checkpoints/...` so git cannot gc it, and stores the
 * incremental diff since the previous turn's snapshot as the Turn diff.
 * Never throws: capture failures must not affect the agent run.
 */
export async function captureTurnCheckpoint(input: {
  readonly session: SessionDetail
  readonly projectPath: string
  readonly runId: string
  /** Epoch ms when the run started; persisted for fold duration labels (ADR 0034). */
  readonly startedAt: number
  /** The Pi session file the Run wrote, when it is not yet the one the Session records. */
  readonly piSessionFile?: string
}): Promise<void> {
  try {
    const sessionId = SessionId(String(input.session.id))
    const snapshotRef = await createWorktreeSnapshot(input.projectPath)
    const previousRef = await getLatestSnapshotRef(sessionId)
    const piSessionFiles = [input.piSessionFile, input.session.piSessionFile]
    const diff = await computeIncrementalDiff(
      input.projectPath,
      previousRef,
      snapshotRef,
      ownPiSessionFolders(input.projectPath, piSessionFiles),
    )

    // Anchor the snapshot so the next turn's diff base stays resolvable.
    if (snapshotRef) {
      const ref = turnCheckpointRef(String(sessionId), input.runId)
      const anchored = await runGit(input.projectPath, ['update-ref', ref, snapshotRef])
      if (anchored.code !== 0) {
        logger.warn('Failed to anchor turn snapshot ref', { ref, stderr: anchored.stderr })
      }
    }

    // Recorded even for empty diffs: the row carries started_at so fold durations
    // stay durable for turns that changed no files (ADR 0034). Empty-diff rows
    // render no changed-files card.
    await recordTurnCheckpoint({
      sessionId,
      turnId: input.runId,
      diff,
      snapshotRef,
      startedAt: input.startedAt,
    })
    if (input.session.environmentMode === 'worktree') {
      const files = parseTurnDiffFilesFromUnifiedDiff(diff)
      await recordDelegationTurnWrites({
        workerSessionId: sessionId,
        runId: input.runId,
        paths: files.map((file) => file.path),
      })
    }
    const pruned = await pruneTurnCheckpoints(sessionId, MAX_CHECKPOINTS_PER_SESSION)
    await deleteTurnCheckpointRefs(input.projectPath, String(sessionId), pruned)
  } catch (error) {
    logger.warn('Failed to capture turn checkpoint', { error: String(error) })
  }
}

/** Remove anchor refs for checkpoints that are no longer retained (best-effort). */
export async function deleteTurnCheckpointRefs(
  projectPath: string,
  sessionId: string,
  turnIds: readonly string[],
): Promise<void> {
  await Promise.all(
    turnIds.map(async (turnId) => {
      const result = await runGit(projectPath, [
        'update-ref',
        '-d',
        turnCheckpointRef(sessionId, turnId),
      ])
      if (result.code !== 0) {
        logger.warn('Failed to delete turn snapshot ref', { turnId, stderr: result.stderr })
      }
    }),
  )
}

/**
 * The folders, relative to the project, that hold the Session's own Pi session files, when a
 * project keeps its Pi sessions inside it (`sessionDir: ".pi/sessions"`) without ignoring them.
 * Pi writes there on every turn, which is not the agent's work, so the turn's changes leave them out.
 */
function ownPiSessionFolders(projectPath: string, files: readonly (string | undefined)[]) {
  const project = physicalPath(projectPath)
  const folders = files.flatMap((file) => {
    if (!file?.trim()) return []
    const folder = physicalPath(path.dirname(file))
    if (!isPathInsideProject(folder, project) || folder === project) return []
    // A pathspec takes `/` on every platform.
    return [path.relative(project, folder).split(path.sep).join('/')]
  })
  return [...new Set(folders)]
}

/** The Pi session file a Run's session wrote, for `captureTurnCheckpoint`. */
export function piSessionFileOf(session: { readonly sessionFile?: string | undefined }) {
  const piSessionFile = session.sessionFile
  return piSessionFile ? { piSessionFile } : {}
}

/** Test seam for a turn's diff, leaving out the folders of `piSessionFiles`. */
export function turnDiffForTests(
  projectPath: string,
  previousRef: string | null,
  currentRef: string | null,
  piSessionFiles: readonly string[],
) {
  return computeIncrementalDiff(
    projectPath,
    previousRef,
    currentRef,
    ownPiSessionFolders(projectPath, piSessionFiles),
  )
}

/** Test seam for the snapshot primitive (see turn-capture.integration.test.ts). */
export function captureWorktreeSnapshotForTests(projectPath: string): Promise<string | null> {
  return createWorktreeSnapshot(projectPath)
}

/**
 * Snapshot the worktree (tracked modifications AND untracked, non-ignored files)
 * without mutating the real index or working tree, by staging into a scratch
 * index file. Returns the snapshot commit SHA, or null when there is nothing to
 * snapshot or the repo has no commits.
 */
async function createWorktreeSnapshot(projectPath: string): Promise<string | null> {
  const head = await runGit(projectPath, ['rev-parse', '--verify', 'HEAD'])
  if (head.code !== 0) return null

  const scratchDir = await mkdtemp(path.join(tmpdir(), 'openwaggle-turn-'))
  const indexFile = path.join(scratchDir, 'index')
  const env = { GIT_INDEX_FILE: indexFile }
  try {
    if (!(await seedScratchIndex(projectPath, indexFile))) {
      const readTree = await runGit(projectPath, ['read-tree', 'HEAD'], { env })
      if (readTree.code !== 0) return null
    }
    // -A stages modifications, deletions and untracked files; .gitignore still applies.
    const add = await runGit(projectPath, ['add', '-A', '--', ':/'], { env })
    if (add.code !== 0) {
      logger.warn('Turn snapshot staging failed', { stderr: add.stderr })
      return null
    }
    const writeTree = await runGit(projectPath, ['write-tree'], { env })
    if (writeTree.code !== 0) return null
    const tree = writeTree.stdout.trim()
    if (!tree) return null

    const headSha = head.stdout.trim()
    const headTree = await runGit(projectPath, ['rev-parse', `${headSha}^{tree}`])
    // Nothing changed since HEAD — no snapshot needed.
    if (headTree.code === 0 && headTree.stdout.trim() === tree) return null

    const commit = await runGit(projectPath, [
      'commit-tree',
      tree,
      '-p',
      headSha,
      '-m',
      'openwaggle-turn-checkpoint',
    ])
    if (commit.code !== 0) {
      logger.warn('Turn snapshot commit-tree failed', { stderr: commit.stderr })
      return null
    }
    return commit.stdout.trim() || null
  } finally {
    await rm(scratchDir, { recursive: true, force: true }).catch(() => {})
  }
}

/**
 * Copy the real index into the scratch index, so `git add -A` below only re-hashes files whose
 * stat data changed. Built from `read-tree HEAD` instead, the index had no stat data and every
 * tracked file was read and hashed again: seconds per turn in a large worktree, on the path that
 * holds the Run open after the agent has finished. The staged content it carries does not matter,
 * because `add -A` replaces it with the working tree. The copy keeps the source's mtime; a newer
 * one could make racily-clean entries look clean.
 *
 * Returns false when there is no index to copy (a fresh repository), and the caller falls back.
 */
async function seedScratchIndex(projectPath: string, indexFile: string): Promise<boolean> {
  const located = await runGit(projectPath, [
    'rev-parse',
    '--path-format=absolute',
    '--git-path',
    'index',
  ])
  const source = located.code === 0 ? located.stdout.trim() : ''
  if (!source) return false
  try {
    const sourceStat = await stat(source)
    await copyFile(source, indexFile)
    await utimes(indexFile, sourceStat.atime, sourceStat.mtime)
    return true
  } catch {
    return false
  }
}

/**
 * Diff between the previous turn snapshot and the current one. Falls back to
 * HEAD as the base when either side is missing so the first turn captures its
 * changes relative to the last commit. A pruned/unresolvable base is logged
 * rather than silently dropping the turn.
 */
async function computeIncrementalDiff(
  projectPath: string,
  previousRef: string | null,
  currentRef: string | null,
  excludedFolders: readonly string[] = [],
): Promise<string> {
  const from = (await resolvableRef(projectPath, previousRef)) ?? 'HEAD'
  const to = currentRef ?? 'HEAD'
  if (from === to) return ''
  const result = await runGit(
    projectPath,
    // Paths are parsed out of this diff, so git must not C-quote them.
    [
      ...['-c', 'core.quotePath=false', 'diff', '--patch', '--find-renames', '--no-ext-diff'],
      ...[from, to, '--', ':/'],
      ...excludedFolders.map((folder) => `:(exclude,literal)${folder}`),
    ],
    { maxBuffer: DIFF_GIT_MAX_BUFFER },
  )
  if (result.code !== 0) {
    logger.warn('Turn diff failed', { from, to, stderr: result.stderr })
    return ''
  }
  return result.stdout
}

/** null when the ref is missing or no longer resolvable (e.g. pruned snapshot). */
async function resolvableRef(projectPath: string, ref: string | null): Promise<string | null> {
  if (!ref) return null
  const result = await runGit(projectPath, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`])
  if (result.code === 0) return ref
  logger.warn('Previous turn snapshot is no longer resolvable; diffing against HEAD', { ref })
  return null
}
