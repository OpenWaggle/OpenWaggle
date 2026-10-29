import type { WorktreeInventorySession } from '@shared/types/worktree-inventory'
import { describe, expect, it } from 'vitest'
import {
  classifyWorktree,
  type WorktreeFacts,
  worktreeArchivedAt,
} from '../worktree-classification'

function session(overrides: Partial<WorktreeInventorySession> = {}): WorktreeInventorySession {
  return {
    sessionId: 's',
    title: 'A Session',
    archived: true,
    archivedAt: 100,
    running: false,
    owner: true,
    ...overrides,
  }
}

function facts(overrides: Partial<WorktreeFacts> = {}): WorktreeFacts {
  return {
    managed: true,
    underManagedRoot: true,
    locked: false,
    sessions: [session()],
    blockers: [],
    uncommittedChangeCount: 0,
    unpublishedCommitCount: 0,
    cleanupFailed: false,
    ...overrides,
  }
}

describe('Worktree archive time', () => {
  it('is the latest Archive time when every Session is archived and idle', () => {
    expect(
      worktreeArchivedAt([
        session({ archivedAt: 100 }),
        session({ sessionId: 't', archivedAt: 300 }),
      ]),
    ).toBe(300)
  })

  it('is null with no Session, an open Session, a Run, or no recorded time', () => {
    expect(worktreeArchivedAt([])).toBeNull()
    expect(
      worktreeArchivedAt([session(), session({ archived: false, archivedAt: null })]),
    ).toBeNull()
    expect(worktreeArchivedAt([session({ running: true })])).toBeNull()
    expect(worktreeArchivedAt([session({ archivedAt: null })])).toBeNull()
  })
})

describe('Worktree groups', () => {
  it('is safe to remove when nothing would be lost and nothing uses it', () => {
    expect(classifyWorktree(facts())).toEqual({ group: 'safe', attention: [] })
    // No Session at all: still safe, and only removed by hand.
    expect(classifyWorktree(facts({ sessions: [] }))).toEqual({ group: 'safe', attention: [] })
  })

  it('needs a decision when removing it would lose work or its state is unknown', () => {
    expect(classifyWorktree(facts({ uncommittedChangeCount: 3 }))).toEqual({
      group: 'decide',
      attention: [{ kind: 'uncommitted-changes', count: 3 }],
    })
    expect(classifyWorktree(facts({ unpublishedCommitCount: 2, locked: true }))).toEqual({
      group: 'decide',
      attention: [{ kind: 'unpublished-commits', count: 2 }, { kind: 'locked' }],
    })
    expect(classifyWorktree(facts({ uncommittedChangeCount: null })).attention).toEqual([
      { kind: 'unknown-state' },
    ])
    expect(classifyWorktree(facts({ cleanupFailed: true })).group).toBe('decide')
    // A clean worktree made outside OpenWaggle always goes through the confirmation.
    const outside = { managed: false, underManagedRoot: false, sessions: [] }
    expect(classifyWorktree(facts(outside))).toEqual({
      group: 'decide',
      attention: [{ kind: 'unmanaged' }],
    })
    // Another profile's worktree in the shared managed folder is never safe to remove here.
    expect(classifyWorktree(facts({ managed: false, sessions: [] }))).toEqual({
      group: 'decide',
      attention: [{ kind: 'unrecorded' }],
    })
  })

  it('is in use while open Sessions, Runs, terminals or Actions use it', () => {
    const open = classifyWorktree(
      facts({
        sessions: [session({ archived: false, archivedAt: null })],
        blockers: [{ kind: 'session', message: 'Archive that Session first.' }],
        uncommittedChangeCount: 1,
      }),
    )
    expect(open).toEqual({
      group: 'in-use',
      attention: [
        { kind: 'open-sessions', count: 1 },
        { kind: 'uncommitted-changes', count: 1 },
      ],
    })
    expect(classifyWorktree(facts({ sessions: [session({ running: true })] })).group).toBe('in-use')
    expect(
      classifyWorktree(facts({ blockers: [{ kind: 'terminal', message: 'A terminal is open.' }] }))
        .group,
    ).toBe('in-use')
  })
})
