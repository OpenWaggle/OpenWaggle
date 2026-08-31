import { describe, expect, it } from 'vitest'
import { sessionsCliUsage } from '../sessions-cli-usage'

describe('Sessions CLI usage', () => {
  it('documents YOLO only on commands that can start a new Run', () => {
    const usage = sessionsCliUsage()

    expect(usage).toContain('sessions spawn <parent-id>')
    expect(usage).toContain('[--authorization ask-for-approval|yolo] [--yolo]')
    expect(usage).toContain(
      'sessions steer <session-id> --text <message> --expected-run <run-id> [--attach <path>]...\n',
    )
    expect(usage).not.toContain(
      'sessions steer <session-id> --text <message> --expected-run <run-id> [--yolo]',
    )
  })

  it('documents the complete Worker placement and specialization surface', () => {
    const usage = sessionsCliUsage()

    expect(usage).toContain('[--workspace share-parent|local|new-worktree]')
    expect(usage).toContain('[--deliverable <text>]... [--accept <criterion>]...')
    expect(usage).toContain('Specialization (create, launch, spawn): --agent <name>')
    expect(usage).toContain(
      'New Worktree (create, launch, fork, spawn, handoff):\n  --workspace new-worktree [--base-ref <ref>] [--start-from-origin]',
    )
    expect(usage).toContain('delegation acknowledge-conflict')
    expect(usage).toContain('delegation propose-amendment')
    expect(usage).toContain('delegation verify')
  })
})
