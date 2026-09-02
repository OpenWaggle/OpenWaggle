import path from 'node:path'
import { withoutCommentLines } from './comment-stripping'

/**
 * The Session worktree branch convention must exist in exactly one place.
 *
 * Worktree birth once derived the branch from the session id while recreation
 * derived it from the recorded path. The mismatch created a divergent branch at
 * the base ref and stranded the session's commit on the original branch.
 */
const SESSION_BRANCH_PREFIX_LITERAL = ['ow', 'session-'].join('/')
const SESSION_BRANCH_CONVENTION_OWNER = 'src/shared/utils/worktree.ts'
const POLICY_OWNER = 'scripts/standards/session-branch.ts'

function normalizePath(filePath: string) {
  return filePath.split(path.sep).join('/')
}

export function containsSessionBranchPrefix(code: string) {
  return code.includes(SESSION_BRANCH_PREFIX_LITERAL)
}

export function collectSessionBranchConventionViolations(file: string, contents: string) {
  const normalized = normalizePath(file)
  if (normalized === SESSION_BRANCH_CONVENTION_OWNER || normalized === POLICY_OWNER) return []
  if (!/\.(?:ts|tsx|mts|cts)$/.test(normalized) || normalized.includes('__tests__')) return []
  const code = withoutCommentLines(contents)
  if (!containsSessionBranchPrefix(code)) return []
  return [
    {
      file: normalized,
      message: `Session worktree branch names must come from sessionWorktreeBranch() or sessionWorktreeBranchForId() in ${SESSION_BRANCH_CONVENTION_OWNER}`,
      detail: `found a local "${SESSION_BRANCH_PREFIX_LITERAL}" literal in code`,
    },
  ]
}
