import { describe, expect, it } from 'vitest'
import { SessionActivity } from '../activity'
import { parseCheckArguments } from '../check'
import type { Finding } from '../findings'
import { qualityFinding } from '../quality-gates-plugin'
import { checkReport, decide, nextLoopState, type LoopState } from '../report'

const blocking: Finding = {
  file: 'src/a.ts',
  line: 1,
  column: 1,
  rule: 'no-empty',
  message: 'Empty.',
  severity: 'block',
}
const advisory: Finding = {
  file: 'src/b.ts',
  rule: 'gate/docs',
  id: 'DOC-01',
  message: 'stale doc',
  severity: 'advisory',
}
const fresh: LoopState = { blocked: undefined, handedOff: undefined }

describe('loop guard', () => {
  it('blocks a new set once, then hands the same set to the user', () => {
    const first = decide([blocking], [], fresh, true)
    expect(first.kind).toBe('block')
    const second = decide([{ ...blocking, line: 9 }], [], nextLoopState(fresh, first), true)
    expect(second.kind).toBe('handoff')
    const third = decide([blocking], [], nextLoopState(nextLoopState(fresh, first), second), true)
    expect(third).toEqual({ kind: 'pass', content: undefined })
  })

  it('blocks again when the set changes', () => {
    const first = decide([blocking], [], fresh, true)
    const changed = decide(
      [{ ...blocking, message: 'Other.' }],
      [],
      nextLoopState(fresh, first),
      true,
    )
    expect(changed.kind).toBe('block')
  })

  it('hands off at once when the run cannot continue', () => {
    expect(decide([blocking], [], fresh, false).kind).toBe('handoff')
  })

  it('never blocks on advisories or tool failures', () => {
    const decision = decide(
      [advisory],
      [{ check: 'lint', files: ['src/a.ts'], reason: 'timed out' }],
      fresh,
      true,
    )
    expect(decision.kind).toBe('pass')
    expect(decision.content?.split('\n')).toEqual([
      'Agent gate passed.',
      'Advisory, does not block:',
      'src/b.ts:1:1 gate/docs [DOC-01] stale doc',
      'gate: lint did not run (timed out); 1 file stays unchecked for the next gate',
    ])
  })

  it('stays silent on a clean gate', () => {
    expect(decide([], [], fresh, true)).toEqual({ kind: 'pass', content: undefined })
  })

  it('prints one line for a clean manual check', () => {
    expect(checkReport([], [], 3, '1.2')).toEqual([
      'agent-gate: no blocking findings in 3 files (1.2s)',
    ])
    expect(checkReport([blocking], [], 1, '1.0')).toEqual([
      'src/a.ts:1:1 no-empty Empty.',
      'agent-gate: 1 blocking finding in 1 file (1.0s)',
    ])
  })
})

describe('Session activity', () => {
  it('asks for a test run after a source change and clears it on a passing run', () => {
    const activity = new SessionActivity()
    activity.recordChanges(['src/a.ts', 'docs/a.md'], { tool: 'edit', commands: [] })
    expect(activity.findings().map((finding) => finding.id)).toEqual(['TEST-05'])
    activity.recordCommands([{ command: 'bunx vitest run src/a', exitCode: 1, failed: true }])
    expect(activity.findings()[0]?.message).toContain('the last test run failed')
    activity.recordCommands([{ command: 'bunx vitest run src/a', exitCode: 0, failed: false }])
    expect(activity.findings()).toEqual([])
  })

  it('needs no test run for docs only', () => {
    const activity = new SessionActivity()
    activity.recordChanges(['README.md'], { tool: 'write', commands: [] })
    activity.recordCommands([{ command: 'bun test', exitCode: 1, failed: true }])
    expect(activity.findings()).toEqual([])
  })

  it('reports a hand-edited generated file until its generator runs', () => {
    const activity = new SessionActivity()
    activity.recordChanges(['bun.lock'], { tool: 'bash', commands: ["sed -i '' s/a/b/ bun.lock"] })
    expect(activity.findings()[0]?.message).toBe(
      "Bun lockfile changed by `sed -i '' s/a/b/ bun.lock`, not its generator; revert it and run the generator",
    )
    activity.recordCommands([{ command: 'bun install', exitCode: 0, failed: false }])
    expect(activity.findings()).toEqual([])
    activity.recordChanges(['bun.lock'], { tool: 'bash', commands: ['bun add zod'] })
    expect(activity.findings()).toEqual([])
  })

  it('keeps unchecked files pending after a pass', () => {
    const activity = new SessionActivity()
    activity.recordChanges(['a.json', 'b.json'], { tool: 'write', commands: [] })
    activity.passed(['b.json'])
    expect([...activity.pending]).toEqual(['b.json'])
  })
})

describe('manual check and plugins', () => {
  it('parses the check arguments', () => {
    expect(
      parseCheckArguments(['--base', 'origin/main', 'src/a.ts', '--runner', 'bun', '--no-plugins']),
    ).toEqual({
      base: 'origin/main',
      runner: 'bun',
      plugins: false,
      files: ['src/a.ts'],
    })
    expect(parseCheckArguments([])).toEqual({
      base: 'HEAD',
      runner: 'oxlint',
      plugins: true,
      files: [],
    })
  })

  it('maps Fallow and React Doctor findings to gate findings', () => {
    expect(
      qualityFinding({
        tool: 'fallow dead-code',
        rule: 'unused-export',
        file: 'src/a.ts',
        line: 3,
        message: 'x',
      }),
    ).toEqual({
      file: 'src/a.ts',
      line: 3,
      rule: 'fallow/dead-code/unused-export',
      id: 'GATE-02',
      message: 'x',
      severity: 'block',
    })
    const doctor = {
      tool: 'react-doctor',
      rule: 'r',
      file: 'src/b.tsx',
      line: undefined,
      message: 'm',
    } as const
    expect(qualityFinding(doctor)).toEqual({
      file: 'src/b.tsx',
      rule: 'react-doctor/r',
      id: 'REACT-07',
      message: 'm',
      severity: 'block',
    })
  })
})
