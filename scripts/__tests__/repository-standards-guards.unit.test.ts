import { describe, expect, it } from 'vitest'
import {
  collectSessionSummaryColumnViolations,
  containsSessionBranchPrefix,
} from '../check-repository-standards'
import { withoutCommentLines } from '../standards/comment-stripping'

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
      'const branch = sessionWorktreeBranch(id) // and ow/session- in a trailing comment',
      'const url = "https://example.com/ow/session-docs"',
    ].join('\n')

    // The trailing-comment case regressed when the match was widened to the whole line.
    expect(containsSessionBranchPrefix(withoutCommentLines(source))).toBe(true)
    expect(
      containsSessionBranchPrefix(
        withoutCommentLines(
          ['// ow/session-<id>', 'const branch = sessionWorktreeBranch(id) // ow/session-x'].join(
            '\n',
          ),
        ),
      ),
    ).toBe(false)
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

  it('still rejects an inline list that merely carries a COUNT subquery', () => {
    /*
     * The rule briefly skipped any query containing `count(` anywhere, which exempted exactly the
     * shape the detail-side row uses - so a list missing `environment_mode` and `worktree_path`, the
     * original production bug, went unreported again.
     */
    const contents =
      'sql<SessionSummaryRow>`SELECT id, title, project_path, ' +
      '(SELECT COUNT(*) FROM messages m WHERE m.session_id = s.id) AS message_count FROM sessions s`'

    expect(collectSessionSummaryColumnViolations(file, contents)).toHaveLength(1)
  })

  it('rejects an inline list that merely begins with an aggregate', () => {
    /*
     * The exemption matched any projection whose *first* term was an aggregate, so the column list
     * behind a leading COUNT(*) was skipped - the same hole as the version that skipped any query
     * containing `count(` at all, in a different disguise.
     */
    const contents =
      'sql<SessionSummaryRow>`SELECT COUNT(*) AS total, id, title, project_path FROM sessions`'

    expect(collectSessionSummaryColumnViolations(file, contents)).toHaveLength(1)
  })

  it('still ignores a projection of aggregates only', () => {
    const contents = 'sql<SessionSummaryRow>`SELECT COUNT(*) AS total, MAX(created_at) FROM sessions`'

    expect(collectSessionSummaryColumnViolations(file, contents)).toEqual([])
  })
})
