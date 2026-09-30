import { describe, expect, it } from 'vitest'
import { queuedFollowUpSourceReachesEveryProject } from '../session-follow-up-session-agent-authorization'

function source(input: {
  readonly callerId?: string
  readonly snapshotScope?: object
  readonly snapshotJson?: string
  readonly parentSessionId?: string
}) {
  return {
    authority_origin_caller_id: input.callerId ?? 'gui:local-user',
    authority_scope_snapshot_json:
      input.snapshotJson ??
      (input.snapshotScope
        ? JSON.stringify({ scope: input.snapshotScope, projectPath: '/a', workingPath: '/a' })
        : null),
    parent_session_id: input.parentSessionId ?? null,
  }
}

function profile(scope: object) {
  return {
    id: 'origin',
    capabilities_json: '["sessions:message"]',
    scope_json: JSON.stringify(scope),
    authorization_ceiling: 'yolo' as const,
    revoked_at: null,
  }
}

describe('queued Follow-up source project reach', () => {
  it('reaches every project for a desktop root with no snapshot or a catalog-wide one', () => {
    expect(queuedFollowUpSourceReachesEveryProject(source({}), undefined)).toBe(true)
    expect(
      queuedFollowUpSourceReachesEveryProject(source({ snapshotScope: { all: true } }), undefined),
    ).toBe(true)
  })

  it('stays in its project when the stored snapshot is narrower', () => {
    expect(
      queuedFollowUpSourceReachesEveryProject(
        source({ snapshotScope: { projectPaths: ['/a'] } }),
        undefined,
      ),
    ).toBe(false)
  })

  it('follows the live profile scope, so narrowing it after queueing takes effect', () => {
    const fromProfile = source({ callerId: 'profile:origin' })
    expect(queuedFollowUpSourceReachesEveryProject(fromProfile, profile({ all: true }))).toBe(true)
    expect(
      queuedFollowUpSourceReachesEveryProject(fromProfile, profile({ projectPaths: ['/a'] })),
    ).toBe(false)
    expect(queuedFollowUpSourceReachesEveryProject(fromProfile, undefined)).toBe(false)
  })

  it('needs both the live profile and the snapshot to be catalog-wide', () => {
    expect(
      queuedFollowUpSourceReachesEveryProject(
        source({ callerId: 'profile:origin', snapshotScope: { projectPaths: ['/a'] } }),
        profile({ all: true }),
      ),
    ).toBe(false)
  })

  it('never lets a Worker reach every project', () => {
    expect(
      queuedFollowUpSourceReachesEveryProject(
        source({ parentSessionId: 'queen', snapshotScope: { all: true } }),
        undefined,
      ),
    ).toBe(false)
  })

  it('fails closed on an unreadable snapshot', () => {
    expect(
      queuedFollowUpSourceReachesEveryProject(source({ snapshotJson: '{"scope":1}' }), undefined),
    ).toBe(false)
  })
})
