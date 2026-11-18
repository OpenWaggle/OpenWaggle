import { describe, expect, it } from 'vitest'
import { buildSessionsToolPayload } from '../sessions-tool-extension'

const workerSource = {
  sessionId: 'session-worker',
  runId: 'run-worker',
  workingDirectory: '/repo/.worktrees/worker',
  projectPath: '/repo',
}

describe('Pi-native Hive tool project scope', () => {
  it.each([
    ['list', { action: 'list' }],
    ['search', { action: 'search', query: 'worker' }],
    ['delegations_list', { action: 'delegations_list' }],
    ['delegations_conflicts', { action: 'delegations_conflicts' }],
  ] as const)('scopes %s to the current project by default', (_action, input) => {
    expect(buildSessionsToolPayload(input, workerSource)).toMatchObject({
      request: { query: { workingPath: '/repo/.worktrees/worker' } },
    })
    expect(JSON.stringify(buildSessionsToolPayload(input, workerSource))).not.toContain(
      '"projectPath"',
    )
  })

  it('treats the caller own project like current, so a Worker is not refused', () => {
    for (const input of [
      { action: 'list', catalogScope: 'project' },
      { action: 'list', catalogScope: 'project', projectPath: '/repo' },
      { action: 'delegations_list', catalogScope: 'project' },
    ] as const) {
      expect(buildSessionsToolPayload(input, workerSource)).toMatchObject({
        request: { query: { workingPath: '/repo/.worktrees/worker' } },
      })
    }
  })

  it('names another project explicitly, for the Host to authorize', () => {
    expect(
      buildSessionsToolPayload(
        { action: 'list', catalogScope: 'project', projectPath: '/other' },
        workerSource,
      ),
    ).toMatchObject({ request: { query: { operation: 'list', projectPath: '/other' } } })
  })

  it('lists unarchived Sessions unless archived is asked for, and honours parentSessionId', () => {
    expect(buildSessionsToolPayload({ action: 'list' }, workerSource)).toMatchObject({
      request: { query: { operation: 'list', archived: false } },
    })
    expect(
      buildSessionsToolPayload(
        { action: 'list', archived: true, parentSessionId: 'session-queen' },
        workerSource,
      ),
    ).toMatchObject({
      request: { query: { archived: true, parentSessionId: 'session-queen' } },
    })
  })
})
