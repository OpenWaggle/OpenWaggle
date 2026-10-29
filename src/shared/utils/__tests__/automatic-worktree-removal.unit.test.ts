import type { WorktreeAttention } from '@shared/types/worktree-inventory'
import { describe, expect, it } from 'vitest'
import {
  type AutomaticWorktreeRemovalCandidate,
  decideAutomaticWorktreeRemoval,
} from '../automatic-worktree-removal'

const DAY = 86_400_000
const ARCHIVED_AT = 1_000 * DAY
const ON = { enabled: true, archivedDays: 30 } as const

function candidate(
  overrides: Partial<AutomaticWorktreeRemovalCandidate> = {},
): AutomaticWorktreeRemovalCandidate {
  return {
    managed: true,
    archivedAt: ARCHIVED_AT,
    group: 'safe',
    blockers: [],
    attention: [],
    ...overrides,
  }
}

describe('Automatic worktree removal decision', () => {
  it('does nothing while the rule is off, or for worktrees it never removes', () => {
    const now = ARCHIVED_AT + 90 * DAY
    expect(decideAutomaticWorktreeRemoval(candidate(), { ...ON, enabled: false }, now)).toEqual({
      kind: 'not-applicable',
    })
    // Created outside OpenWaggle.
    expect(decideAutomaticWorktreeRemoval(candidate({ managed: false }), ON, now).kind).toBe(
      'not-applicable',
    )
    // No Session, or one that is not archived: there is no archive time to count from.
    expect(decideAutomaticWorktreeRemoval(candidate({ archivedAt: null }), ON, now).kind).toBe(
      'not-applicable',
    )
  })

  it('waits until every Session has been archived for the chosen days', () => {
    const dueAt = ARCHIVED_AT + 30 * DAY
    expect(decideAutomaticWorktreeRemoval(candidate(), ON, dueAt - 1)).toEqual({
      kind: 'waiting',
      dueAt,
    })
    expect(decideAutomaticWorktreeRemoval(candidate(), ON, dueAt)).toEqual({ kind: 'due', dueAt })
  })

  it('keeps a due worktree that would lose work, naming the first reason to act on', () => {
    const now = ARCHIVED_AT + 60 * DAY
    const kept = (attention: readonly WorktreeAttention[]) =>
      decideAutomaticWorktreeRemoval(candidate({ group: 'decide', attention }), ON, now)

    expect(kept([{ kind: 'unpublished-commits', count: 2 }])).toMatchObject({
      kind: 'kept',
      reason: 'unpublished-commits',
    })
    expect(
      kept([
        { kind: 'unpublished-commits', count: 2 },
        { kind: 'uncommitted-changes', count: 1 },
      ]),
    ).toMatchObject({ reason: 'uncommitted-changes' })
    expect(kept([{ kind: 'unknown-state' }])).toMatchObject({ reason: 'unknown-state' })
    expect(kept([{ kind: 'locked' }])).toMatchObject({ reason: 'locked' })
    expect(kept([{ kind: 'cleanup-failed' }, { kind: 'locked' }])).toMatchObject({
      reason: 'cleanup-failed',
    })
    expect(
      decideAutomaticWorktreeRemoval(
        candidate({ blockers: [{ kind: 'terminal', message: 'A terminal is open.' }] }),
        ON,
        now,
      ),
    ).toMatchObject({ kind: 'kept', reason: 'in-use' })
  })
})
