import { describe, expect, it } from 'vitest'
import {
  MAX_REPORTED_FINDINGS,
  deadCodeFindings,
  duplicationFindings,
  feedbackMessage,
  reactDoctorFindings,
} from '../findings'

const CHANGED = new Set(['src/changed.ts', 'src/view.tsx', 'package.json'])

const DEAD_CODE_REPORT = JSON.stringify({
  kind: 'dead-code',
  total_issues: 5,
  summary: { total_issues: 5 },
  unused_exports: [
    { path: 'src/changed.ts', export_name: 'helper', line: 12 },
    { path: 'src/untouched.ts', export_name: 'other', line: 3 },
  ],
  unused_class_members: [
    { path: 'src/changed.ts', parent_name: 'Store', member_name: 'reset', line: 40 },
  ],
  unused_dependencies: [{ path: 'package.json', package_name: 'left-pad', line: 20 }],
  circular_dependencies: [
    { files: ['src/a.ts', 'src/changed.ts'], line: 1, edges: [{ path: 'src/a.ts', line: 1 }] },
  ],
  next_steps: [{ id: 'trace', command: 'fallow dead-code --trace src/changed.ts:helper' }],
  workspace_diagnostics: [{ path: '.', kind: 'boundaries-not-configured' }],
})

const DUPES_REPORT = JSON.stringify({
  clone_groups: [
    {
      instances: [
        { file: 'src/changed.ts', start_line: 10, end_line: 30 },
        { file: 'src/twin.ts', start_line: 5, end_line: 25 },
      ],
    },
    {
      instances: [
        { file: 'src/x.ts', start_line: 1, end_line: 9 },
        { file: 'src/y.ts', start_line: 1, end_line: 9 },
      ],
    },
  ],
})

const REACT_DOCTOR_REPORT = JSON.stringify({
  projects: [
    {
      diagnostics: [
        {
          filePath: 'src/view.tsx',
          plugin: 'react-doctor',
          rule: 'no-derived-state',
          line: 7,
          message: 'Derived state.',
          help: 'Compute it in render.',
        },
        {
          filePath: 'src/other.tsx',
          plugin: 'react-doctor',
          rule: 'no-eval',
          line: 1,
          message: 'eval',
        },
      ],
    },
  ],
})

describe('quality gate reports', () => {
  it('keeps dead-code findings in changed files, cycles through a changed file included', () => {
    expect(deadCodeFindings(DEAD_CODE_REPORT, CHANGED)).toEqual([
      {
        tool: 'fallow dead-code',
        rule: 'unused-export',
        file: 'src/changed.ts',
        line: 12,
        message: 'helper',
      },
      {
        tool: 'fallow dead-code',
        rule: 'unused-class-member',
        file: 'src/changed.ts',
        line: 40,
        message: 'Store.reset',
      },
      {
        tool: 'fallow dead-code',
        rule: 'unused-dependency',
        file: 'package.json',
        line: 20,
        message: 'left-pad',
      },
      {
        tool: 'fallow dead-code',
        rule: 'circular-dependency',
        file: 'src/changed.ts',
        line: 1,
        message: 'src/a.ts -> src/changed.ts',
      },
    ])
  })

  it('keeps clone groups with an instance in a changed file', () => {
    expect(duplicationFindings(DUPES_REPORT, CHANGED)).toEqual([
      {
        tool: 'fallow dupes',
        rule: 'code-duplication',
        file: 'src/changed.ts',
        line: 10,
        message: 'lines 10-30 duplicate src/twin.ts:5-25',
      },
    ])
  })

  it('keeps React Doctor diagnostics in changed files', () => {
    expect(reactDoctorFindings(REACT_DOCTOR_REPORT, CHANGED)).toEqual([
      {
        tool: 'react-doctor',
        rule: 'react-doctor/no-derived-state',
        file: 'src/view.tsx',
        line: 7,
        message: 'Derived state. Compute it in render.',
      },
    ])
  })

  it('reads nothing from a missing or malformed report', () => {
    expect(deadCodeFindings('', CHANGED)).toEqual([])
    expect(duplicationFindings('not json', CHANGED)).toEqual([])
    expect(reactDoctorFindings('[]', CHANGED)).toEqual([])
  })

  it('writes one line per finding and caps the list', () => {
    const findings = deadCodeFindings(DEAD_CODE_REPORT, CHANGED)
    const message = feedbackMessage(findings)
    expect(message).toContain('Quality gates found 4 issues in files you changed.')
    expect(message).toContain('- src/changed.ts:12 fallow dead-code unused-export: helper')
    expect(message).toContain('never a suppression comment')

    const many = Array.from({ length: MAX_REPORTED_FINDINGS + 2 }, () => findings[0]).filter(
      (finding) => finding !== undefined,
    )
    expect(feedbackMessage(many)).toContain('- and 2 more;')
  })
})
