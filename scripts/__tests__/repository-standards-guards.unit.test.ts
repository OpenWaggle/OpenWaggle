import { describe, expect, it } from 'vitest'
import {
  collectSessionSummaryColumnViolations,
  containsSessionBranchPrefix,
  withoutCommentLines,
} from '../check-repository-standards'

describe('session branch prefix detection', () => {
  it('matches the prefix wherever it appears, not only after a quote', () => {
    /*
     * Two rounds of review narrowed this guard. Template-literal-only missed
     * `const p = 'ow/session-x'`; requiring a quote immediately before the prefix still missed every
     * use where it is not at the start of the string, which is the most natural way to write it.
     */
    expect(containsSessionBranchPrefix('const a = `refs/heads/ow/session-${id}`')).toBe(true)
    expect(containsSessionBranchPrefix("const b = 'ow/session-' + id")).toBe(true)
    expect(containsSessionBranchPrefix('const c = "ow/session-probe"')).toBe(true)
    expect(containsSessionBranchPrefix('const d = sessionWorktreeBranch(id)')).toBe(false)
  })

  it('ignores the convention when it only appears in comments', () => {
    const source = [
      '// branches are named ow/session-<id>',
      '/* also ow/session- in a block */',
      'const branch = sessionWorktreeBranch(id)',
    ].join('\n')

    expect(containsSessionBranchPrefix(withoutCommentLines(source))).toBe(false)
  })
})

describe('SessionSummaryRow column detection', () => {
  const file = 'src/main/store/sessions/queries.ts'

  it('rejects an inline column list even when it omits the columns the row promises', () => {
    /*
     * The guard used to fire only when the list mentioned `created_at`, which let through exactly
     * the defect it exists for: three queries omitted `environment_mode` and `worktree_path`, so
     * every session reported local mode with no worktree and nothing failed.
     */
    const contents = 'sql<SessionSummaryRow>`SELECT id, title, project_path FROM sessions`'

    expect(collectSessionSummaryColumnViolations(file, contents)).toHaveLength(1)
  })

  it('accepts a query that interpolates the shared column fragment', () => {
    const contents = 'sql<SessionSummaryRow>`SELECT ${sessionSummaryColumns(sql)} FROM sessions`'

    expect(collectSessionSummaryColumnViolations(file, contents)).toEqual([])
  })

  it('ignores a count query, which selects no columns', () => {
    const contents = 'sql<SessionSummaryRow>`SELECT COUNT(*) AS total FROM sessions`'

    expect(collectSessionSummaryColumnViolations(file, contents)).toEqual([])
  })
})
