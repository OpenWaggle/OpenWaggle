import { spawn } from 'node:child_process'
import { turnCheckpointSessionNamespace } from '@shared/utils/turn-checkpoint-ref'
import { runGit } from './run-git'

export interface CheckpointRefSnapshot {
  readonly name: string
  readonly objectId: string
}

function updateRefsAtomically(projectPath: string, commands: readonly string[]) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn('git', ['update-ref', '--stdin'], {
      cwd: projectPath,
      stdio: ['pipe', 'ignore', 'pipe'],
    })
    let stderr = ''
    let settled = false
    const fail = (error: Error) => {
      if (settled) return
      settled = true
      reject(error)
    }
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk
    })
    child.once('error', fail)
    child.stdin.once('error', fail)
    child.once('close', (code) => {
      if (settled) return
      if (code === 0) {
        settled = true
        resolve()
      } else {
        fail(new Error(stderr.trim() || `git update-ref failed with exit code ${String(code)}.`))
      }
    })
    child.stdin.end(`start\n${commands.join('\n')}\nprepare\ncommit\n`)
  })
}

function parseRefSnapshots(stdout: string): readonly CheckpointRefSnapshot[] {
  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const separator = line.indexOf(' ')
      if (separator < 1) throw new Error('Git returned an invalid checkpoint ref record.')
      return { name: line.slice(0, separator), objectId: line.slice(separator + 1) }
    })
}

/**
 * Delete every Turn checkpoint anchor ref belonging to a session atomically.
 *
 * Snapshot commits hold a full tree of the working copy, including untracked files, and the
 * anchor refs keep them permanently reachable: verified that a ref under this namespace
 * survives worktree removal, branch deletion and `git gc --prune=now`. Deleting only the DB
 * rows when a session died therefore leaked those objects into the user's real repository
 * forever, with no way to reclaim the space.
 *
 * Deletes the whole per-session namespace rather than a list of turn ids, so refs whose rows
 * were already pruned (or never recorded) are collected too.
 */
export async function deleteSessionTurnCheckpointRefs(
  projectPath: string,
  sessionId: string,
  beforeDelete?: (refs: readonly CheckpointRefSnapshot[]) => Promise<void>,
): Promise<readonly CheckpointRefSnapshot[]> {
  const namespace = turnCheckpointSessionNamespace(sessionId)
  const listed = await runGit(projectPath, [
    'for-each-ref',
    '--format=%(refname) %(objectname)',
    namespace,
  ])
  if (listed.code !== 0) {
    throw new Error(
      listed.stderr.trim() || `Could not list turn checkpoint refs for Session ${sessionId}.`,
    )
  }

  const refs = parseRefSnapshots(listed.stdout)
  await beforeDelete?.(refs)
  if (refs.length === 0) return []
  await updateRefsAtomically(
    projectPath,
    refs.map((ref) => `delete ${ref.name} ${ref.objectId}`),
  )
  return refs
}

export async function restoreSessionTurnCheckpointRefs(
  projectPath: string,
  refs: readonly CheckpointRefSnapshot[],
): Promise<void> {
  if (refs.length === 0) return
  await updateRefsAtomically(
    projectPath,
    refs.map((ref) => `create ${ref.name} ${ref.objectId}`),
  )
}
