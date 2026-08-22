import { execFile as execFileCallback } from 'node:child_process'
import { promisify } from 'node:util'

const execFile = promisify(execFileCallback)

/**
 * Whether `ancestor` is reachable from `descendant`.
 *
 * Shared by the commit-policy range resolution and the upstream-merge attribution, which must agree
 * on what "already contained in the base branch" means.
 */
export async function isAncestor(cwd: string, ancestor: string, descendant: string) {
  try {
    await execFile('git', ['merge-base', '--is-ancestor', ancestor, descendant], { cwd })
    return true
  } catch {
    return false
  }
}
