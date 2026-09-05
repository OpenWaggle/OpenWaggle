import { describe, expect, it } from 'vitest'
import { hydrateSessionSummary } from '../hydration'
import type { SessionSummaryRow } from '../types'

function row(overrides: Partial<SessionSummaryRow> = {}): SessionSummaryRow {
  return {
    id: 'session-1',
    title: 'A session',
    project_path: '/repo',
    archived: 0,
    created_at: 1,
    updated_at: 2,
    last_active_node_id: null,
    last_active_branch_id: null,
    environment_mode: 'local',
    worktree_path: null,
    lineage_present: 0,
    lineage_role: 'independent',
    parent_session_id: null,
    direct_worker_count: 0,
    active_direct_worker_count: 0,
    agent_definition_name: null,
    delegation_state: null,
    ...overrides,
  }
}

describe('hydrateSessionSummary', () => {
  /**
   * Session lists need these two fields to resolve each row's working path and show
   * that session's own git state. They were missing from this hydration path while a
   * second, unused `hydrateSessionSummary` in the session-detail module had them, so
   * everything typechecked and the sidebar silently had nothing to work with. Only
   * running the app surfaced it, which is why it is pinned here.
   */
  it('carries the fields that resolve a session working path', () => {
    const summary = hydrateSessionSummary(
      row({ environment_mode: 'worktree', worktree_path: '/wt/session-1' }),
    )

    expect(summary.environmentMode).toBe('worktree')
    expect(summary.worktreePath).toBe('/wt/session-1')
  })

  it('treats any non-worktree mode as local', () => {
    expect(hydrateSessionSummary(row({ environment_mode: 'local' })).environmentMode).toBe('local')
    expect(hydrateSessionSummary(row({ environment_mode: null })).environmentMode).toBe('local')
    expect(hydrateSessionSummary(row({ environment_mode: 'nonsense' })).environmentMode).toBe(
      'local',
    )
  })

  it('keeps a null worktree path null rather than coercing it', () => {
    expect(hydrateSessionSummary(row({ worktree_path: null })).worktreePath).toBeNull()
  })

  it('maps the remaining summary fields', () => {
    const summary = hydrateSessionSummary(row({ archived: 1 }))

    expect(summary.title).toBe('A session')
    expect(summary.projectPath).toBe('/repo')
    expect(summary.archived).toBe(true)
    expect(summary.createdAt).toBe(1)
    expect(summary.updatedAt).toBe(2)
  })

  it('hydrates production Hive lineage only when the query marks it present', () => {
    expect(hydrateSessionSummary(row()).lineage).toBeUndefined()
    expect(
      hydrateSessionSummary(
        row({
          lineage_present: 1,
          lineage_role: 'worker',
          parent_session_id: 'parent-session',
          agent_definition_name: 'reviewer',
          delegation_state: 'working',
        }),
      ).lineage,
    ).toMatchObject({
      role: 'worker',
      parentSessionId: 'parent-session',
      agentDefinitionName: 'reviewer',
      delegationState: 'working',
    })
  })
})
