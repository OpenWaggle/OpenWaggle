import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseDocument } from 'yaml'

const WORKFLOW_PATH = path.join(process.cwd(), '.github/workflows/usage-stats.yml')
const WORKFLOW = fs.readFileSync(WORKFLOW_PATH, 'utf8')
const EXECUTABLE = WORKFLOW.split('\n')
  .filter((line) => !line.trimStart().startsWith('#'))
  .join('\n')

describe('usage statistics snapshot workflow', () => {
  it('is valid YAML', () => {
    expect(parseDocument(WORKFLOW, { strict: true, uniqueKeys: true }).errors).toEqual([])
  })

  it('runs daily and on demand, only in the OpenWaggle repository', () => {
    expect(EXECUTABLE).toMatch(/^on:\n {2}schedule:\n {4}- cron: "\d+ \d+ \* \* \*"\n {2}workflow_dispatch:$/mu)
    expect(EXECUTABLE).toContain("if: github.repository == 'OpenWaggle/OpenWaggle'")
    expect(EXECUTABLE).toContain('concurrency:\n  group: usage-stats-snapshot\n  cancel-in-progress: false')
  })

  it('reads the repository and never writes to it', () => {
    expect(EXECUTABLE).toContain('permissions:\n  contents: read')
    expect(EXECUTABLE.match(/permissions:/gu)).toHaveLength(1)
    expect(EXECUTABLE).not.toMatch(/: write\b/u)
    expect(EXECUTABLE).toContain('persist-credentials: false')
    expect(EXECUTABLE).not.toMatch(/\bgit (?:push|commit|tag)\b/u)
    expect(EXECUTABLE).not.toContain('pull_request_target')
  })

  it('pins every third-party action to a commit SHA, like the other workflows', () => {
    const uses = [...EXECUTABLE.matchAll(/uses:\s*(\S+)/gu)].map((match) => match[1] ?? '')
    expect(uses).toEqual([
      'actions/checkout@df4cb1c069e1874edd31b4311f1884172cec0e10',
      'pnpm/action-setup@b906affcce14559ad1aafd4ab0e942779e9f58b1',
      'actions/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e',
      './.github/actions/pnpm-install',
    ])
  })

  it('passes secrets through the environment and runs the snapshot script', () => {
    expect(EXECUTABLE).toContain('STATS_SNAPSHOT_TOKEN: ${{ secrets.STATS_SNAPSHOT_TOKEN }}')
    expect(EXECUTABLE).toContain('STATS_GITHUB_TOKEN: ${{ secrets.STATS_GITHUB_TOKEN }}')
    expect(EXECUTABLE).toContain('run: pnpm exec tsx scripts/usage-stats-snapshot.ts')
    expect(EXECUTABLE).not.toMatch(/run:.*\$\{\{\s*secrets\./u)
  })
})
