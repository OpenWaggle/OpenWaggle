import { describe, expect, it } from 'vitest'
import { buildSessionsToolPayload } from '../sessions-tool-extension'

describe('Pi-native Sessions tool project scope', () => {
  it('uses the canonical source project for project-scoped catalog queries', () => {
    const source = {
      sessionId: 'session-worker',
      runId: 'run-worker',
      workingDirectory: '/repo/.worktrees/worker',
      projectPath: '/repo',
    }
    expect(
      buildSessionsToolPayload({ action: 'list', catalogScope: 'project' }, source),
    ).toMatchObject({ request: { query: { operation: 'list', projectPath: '/repo' } } })
    expect(
      buildSessionsToolPayload({ action: 'delegations_list', catalogScope: 'project' }, source),
    ).toMatchObject({
      request: { query: { operation: 'delegations-list', projectPath: '/repo' } },
    })
    expect(() =>
      buildSessionsToolPayload(
        { action: 'search', query: 'worker', catalogScope: 'project' },
        { sessionId: 'session-worker', runId: 'run-worker' },
      ),
    ).toThrow('requires a canonical project path')
  })
})
