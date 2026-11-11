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
  rule: 'gate/generated',
  id: 'TOOL-07',
  message: 'route tree changed',
  severity: 'advisory',
}
const fresh: LoopState = { blocked: undefined, given: undefined }

describe('loop guard', () => {
  it('blocks a new set once, then stops silently on the same set', () => {
    const first = decide([blocking], fresh, true)
    expect(first.kind).toBe('block')
    const second = decide([{ ...blocking, line: 9 }], nextLoopState(fresh, first), true)
    expect(second).toEqual({ kind: 'stop', key: expect.any(String) })
    expect(second).not.toHaveProperty('content')
    const third = decide([blocking], nextLoopState(nextLoopState(fresh, first), second), true)
    expect(third).toEqual({ kind: 'pass' })
  })

  it('blocks again when the set changes', () => {
    const first = decide([blocking], fresh, true)
    const changed = decide([{ ...blocking, message: 'Other.' }], nextLoopState(fresh, first), true)
    expect(changed.kind).toBe('block')
  })

  it('stops at once when the run cannot continue', () => {
    expect(decide([blocking], fresh, false).kind).toBe('stop')
  })

  it('passes silently on advisories and a clean gate', () => {
    expect(decide([advisory], fresh, true)).toEqual({ kind: 'pass' })
    expect(decide([], fresh, true)).toEqual({ kind: 'pass' })
  })

  it('lists advisories and tool failures in the manual check only', () => {
    expect(
      checkReport(
        [advisory],
        [{ check: 'lint', files: ['src/a.ts'], reason: 'timed out' }],
        1,
        '1.0',
      ),
    ).toEqual([
      'agent-gate: no blocking findings in 1 file (1.0s)',
      'Advisory, does not block:',
      'src/b.ts:1:1 gate/generated [TOOL-07] route tree changed',
      'gate: lint did not run (timed out); 1 file stays unchecked for the next gate',
    ])
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
  it('reports a hand-edited generated file until its generator runs', () => {
    const activity = new SessionActivity()
    activity.recordChanges(['bun.lock'], { tool: 'bash', commands: ["sed -i '' s/a/b/ bun.lock"] })
    expect(activity.findings()[0]?.message).toBe(
      "Bun lockfile changed by `sed -i '' s/a/b/ bun.lock`, not its generator; revert it and run the generator",
    )
    activity.recordCommands([{ command: 'bun install' }])
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
