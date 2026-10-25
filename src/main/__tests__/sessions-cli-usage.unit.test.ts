import { describe, expect, it } from 'vitest'
import { sessionsCliUsage } from '../sessions-cli-usage'

describe('Hive CLI usage', () => {
  it('documents YOLO only on commands that can start a new Run', () => {
    const usage = sessionsCliUsage()

    expect(usage).toContain('hive spawn <parent-id>')
    expect(usage).toContain('[--authorization ask-for-approval|yolo] [--yolo]')
    expect(usage).toContain(
      'hive steer <session-id> --text <message> --expected-run <run-id> [--attach <path>]...\n',
    )
    expect(usage).not.toContain(
      'hive steer <session-id> --text <message> --expected-run <run-id> [--yolo]',
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
    expect(usage).toContain('hive delegation-conflict-acknowledge')
    expect(usage).toContain('hive delegation-propose-amendment')
    expect(usage).toContain('hive delegation-verify')
  })

  it('documents queue-body access on each durable export-history read', () => {
    const usage = sessionsCliUsage()

    expect(usage).toContain(
      'hive exports-list <session-id> [--status <status>]... [--limit <n>] [--cursor <cursor>]\n    [--include-queue-bodies]',
    )
    expect(usage).toContain(
      'hive exports-read <session-id> <export-operation-id> [--include-queue-bodies]',
    )
    expect(usage).toContain('[--after-host <id> --after-sequence <n>] [--include-queue-bodies]')
  })

  it('names each subcommand for the hive tool action it mirrors (ADR 0053)', () => {
    const usage = sessionsCliUsage()

    expect(usage).not.toContain('openwaggle sessions')
    expect(usage).not.toContain('openwaggle delegations')
    for (const subcommand of [
      'follow-up',
      'interrupt-descendants',
      'delegations-list',
      'delegations-read',
      'delegations-conflicts',
      'delegation-submit',
      'delegation-accept',
      'delegation-request-revision',
      'queue-list',
      'queue-withdraw',
      'requests-list',
      'request-respond',
      'approval-respond',
      'authorization-set',
      'export-create',
      'export-cancel',
      'exports-list',
      'exports-read',
      'exports-wait',
      'agent-definitions-list',
      'agent-definitions-search',
    ]) {
      expect(usage).toContain(`openwaggle hive ${subcommand} `)
    }
  })
})
