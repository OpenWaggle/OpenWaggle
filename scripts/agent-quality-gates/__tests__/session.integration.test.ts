import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { changedFiles, takeSnapshot } from '../changed-files'
import type { Finding } from '../findings'
import type { QualityGateRun } from '../gates'
import { runProcess } from '../process'
import { MAX_FEEDBACK_ROUNDS, QualityGateSession } from '../session'

let directory = ''

function git(...args: string[]) {
  return execFileSync(
    'git',
    ['-c', 'user.name=Tests', '-c', 'user.email=tests@openwaggle.ai', ...args],
    {
      cwd: directory,
      encoding: 'utf8',
    },
  )
}

function write(file: string, content: string) {
  writeFileSync(path.join(directory, file), content)
}

beforeEach(() => {
  directory = mkdtempSync(path.join(tmpdir(), 'quality-gates-'))
  git('init', '-q', '-b', 'main')
  write('committed.ts', 'export const a = 1\n')
  write('dirty-before.ts', 'export const b = 1\n')
  git('add', '.')
  git('commit', '-q', '-m', 'feat: base')
  // Dirty before the run starts: not the agent's change unless it touches it again.
  write('dirty-before.ts', 'export const b = 2\n')
  write('untracked-before.ts', 'export const c = 1\n')
})

afterEach(() => {
  rmSync(directory, { recursive: true, force: true })
})

describe('changed files', () => {
  it('counts only what changed after the snapshot, committed or not', async () => {
    const snapshot = await takeSnapshot(runProcess, directory)
    expect(snapshot).toBeDefined()
    if (snapshot === undefined) {
      return
    }
    expect(await changedFiles(runProcess, snapshot)).toEqual([])

    write('committed.ts', 'export const a = 2\n')
    write('new-file.ts', 'export const d = 1\n')
    write('untracked-before.ts', 'export const c = 2\n')
    write('dirty-before.ts', 'export const b = 1\n')
    git('add', 'committed.ts')
    git('commit', '-q', '-m', 'fix: change a')

    expect((await changedFiles(runProcess, snapshot)).sort()).toEqual([
      'committed.ts',
      'dirty-before.ts',
      'new-file.ts',
      'untracked-before.ts',
    ])
  })

  it('has no snapshot outside a repository', async () => {
    const outside = mkdtempSync(path.join(tmpdir(), 'not-a-repo-'))
    expect(await takeSnapshot(runProcess, outside)).toBeUndefined()
    rmSync(outside, { recursive: true, force: true })
  })
})

describe('quality gate session', () => {
  const FINDING: Finding = {
    tool: 'react-doctor',
    rule: 'react-doctor/no-eval',
    file: 'view.ts',
    line: 1,
    message: 'eval',
  }

  function session(findings: (run: QualityGateRun) => Finding[]) {
    const calls: QualityGateRun[] = []
    const gate = new QualityGateSession({
      findings: async (run) => {
        calls.push(run)
        return findings(run)
      },
    })
    return { gate, calls }
  }

  it('stays silent when the run changed nothing', async () => {
    const { gate, calls } = session(() => [FINDING])
    await gate.start(directory)
    expect(await gate.beforeSettle({ outcome: 'completed', canContinue: true })).toBeUndefined()
    expect(calls).toEqual([])
  })

  it('stays silent when the changed files are clean', async () => {
    const { gate, calls } = session(() => [])
    await gate.start(directory)
    write('view.ts', 'export const v = 1\n')
    expect(await gate.beforeSettle({ outcome: 'completed', canContinue: true })).toBeUndefined()
    expect(calls.map((call) => call.files)).toEqual([['view.ts']])
  })

  it('reports findings in changed files, then lets the run settle after the round budget', async () => {
    const { gate } = session(() => [FINDING])
    await gate.start(directory)
    write('view.ts', 'eval("1")\n')
    for (let round = 0; round < MAX_FEEDBACK_ROUNDS; round += 1) {
      const feedback = await gate.beforeSettle({ outcome: 'completed', canContinue: true })
      expect(feedback?.content).toContain('- view.ts:1 react-doctor react-doctor/no-eval: eval')
    }
    expect(await gate.beforeSettle({ outcome: 'completed', canContinue: true })).toBeUndefined()

    gate.settled()
    await gate.start(directory)
    write('view.ts', 'eval("2")\n')
    expect(await gate.beforeSettle({ outcome: 'completed', canContinue: true })).toBeDefined()
  })

  it('skips failed, aborted and non-continuable runs', async () => {
    const { gate, calls } = session(() => [FINDING])
    await gate.start(directory)
    write('view.ts', 'eval("1")\n')
    expect(await gate.beforeSettle({ outcome: 'aborted', canContinue: true })).toBeUndefined()
    expect(await gate.beforeSettle({ outcome: 'error', canContinue: true })).toBeUndefined()
    expect(await gate.beforeSettle({ outcome: 'completed', canContinue: false })).toBeUndefined()
    expect(calls).toEqual([])
  })
})
