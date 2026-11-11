import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AgentGateSession, type ToolCall } from '../session'

let root = ''
let calls = 0

function git(...args: string[]) {
  execFileSync('git', args, { cwd: root, stdio: 'ignore' })
}

function write(file: string, text: string) {
  mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
  writeFileSync(path.join(root, file), text)
}

/** One bash call that runs `effect` between the gate's before and after hooks. */
async function bash(session: AgentGateSession, command: string, effect: () => void) {
  calls += 1
  const call: ToolCall = { id: `call-${calls}`, name: 'bash', input: { command } }
  await session.beforeTool(call)
  effect()
  await session.afterTool({ ...call, isError: false })
}

function content(decision: Awaited<ReturnType<AgentGateSession['settle']>>) {
  return decision?.kind === 'block' ? decision.content : ''
}

const COMPLETED = { outcome: 'completed', canContinue: true } as const

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'agent-gate-'))
  git('init', '-q')
  git('config', 'user.email', 'gate@example.com')
  git('config', 'user.name', 'Gate')
  write('package.json', JSON.stringify({ name: 'x', dependencies: { a: '1.0.0' } }, null, 2))
  write('.gitignore', 'node_modules/\n')
  write('tsconfig.json', '{ "compilerOptions": { "strict": true }, "include": ["src"] }')
  write('src/a.ts', 'export const a = 1\n')
  write('src/__tests__/a.unit.test.ts', "it('works', () => {})\n")
  write('oxlint.config.mts', "export default {\n  rules: {\n    'no-console': 'error',\n  },\n}\n")
  write('scripts/check/output-budget.json', '{ "check": 20 }\n')
  git('add', '-A')
  git('commit', '-q', '-m', 'init')
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('agent gate Session', () => {
  it('catches a shell edit, blocks once, then stops silently on the same findings', async () => {
    const session = new AgentGateSession()
    await session.start(root)
    await bash(session, "printf '// @ts-ignore\\n' >> src/a.ts", () =>
      write('src/a.ts', 'export const a = 1\n// @ts-ignore\n'),
    )

    const first = await session.settle(COMPLETED)
    expect(first?.kind).toBe('block')
    const lines = content(first).split('\n')
    expect(lines).toContain(
      'src/a.ts:2:1 gate/suppressions [TS-08] new @ts-ignore comment; fix the code or the shared config instead',
    )
    // No lint tools in the scratch repository: their failures stay out of the agent's message.
    expect(lines.filter((line) => line.startsWith('gate: '))).toEqual([])
    expect(lines.join('\n')).not.toContain('TEST-05')

    expect(await session.settle(COMPLETED)).toEqual({ kind: 'stop', key: expect.any(String) })
    expect(await session.settle(COMPLETED)).toEqual({ kind: 'pass' })
  })

  it('passes silently with no test run, keeping tool-failed files for the next gate', async () => {
    const session = new AgentGateSession()
    await session.start(root)
    await bash(session, 'edit', () => write('src/a.ts', 'export const a = 2\n'))
    expect(await session.settle(COMPLETED)).toEqual({ kind: 'pass' })
    // The tools that failed to run leave src/a.ts pending, so the next stop checks it again.
    expect(await session.settle(COMPLETED)).toEqual({ kind: 'pass' })
  })

  it('stays quiet when nothing changed and ignores files changed before the Session', async () => {
    write('src/a.ts', 'export const a = 3 // @ts-ignore\n')
    const session = new AgentGateSession()
    await session.start(root)
    await bash(session, 'ls', () => undefined)
    expect(await session.settle(COMPLETED)).toBeUndefined()
  })

  it('flags a generated file edited by hand through the edit tool', async () => {
    const session = new AgentGateSession()
    await session.start(root)
    write('bun.lock', '{}\n')
    await session.afterTool({ id: 'e1', name: 'edit', input: { path: 'bun.lock' }, isError: false })
    expect(content(await session.settle(COMPLETED))).toContain(
      'bun.lock:1:1 gate/generated [TOOL-07] Bun lockfile changed by the edit tool',
    )
  })

  it('blocks a weaker tsconfig, with no prompt', async () => {
    const session = new AgentGateSession()
    await session.start(root)
    await bash(session, 'edit tsconfig', () =>
      write('tsconfig.json', '{ "compilerOptions": { "strict": false }, "include": ["src"] }'),
    )
    expect(content(await session.settle(COMPLETED))).toContain(
      'tsconfig.json:1:1 gate/tsconfig [TS-01] strict checks less on 2 files: src/__tests__/a.unit.test.ts, src/a.ts',
    )
  })

  it('passes a stricter tsconfig', async () => {
    const session = new AgentGateSession()
    await session.start(root)
    await bash(session, 'edit tsconfig', () =>
      write(
        'tsconfig.json',
        '{ "compilerOptions": { "strict": true, "noUncheckedIndexedAccess": true }, "include": ["src"] }',
      ),
    )
    expect(content(await session.settle(COMPLETED))).not.toContain('TS-01')
  })

  it('leaves a new dependency to review', async () => {
    const session = new AgentGateSession()
    await session.start(root)
    await bash(session, 'bun add b', () =>
      write(
        'package.json',
        JSON.stringify({ name: 'x', dependencies: { a: '1.0.0', b: '^1.0.0' } }),
      ),
    )
    expect(await session.settle(COMPLETED)).toEqual({ kind: 'pass' })
  })

  it('blocks a lint rule turned off, a raised budget and a skipped test', async () => {
    const session = new AgentGateSession()
    await session.start(root)
    await bash(session, 'loosen', () => {
      write(
        'oxlint.config.mts',
        "export default {\n  rules: {\n    'no-console': 'off',\n  },\n}\n",
      )
      write('scripts/check/output-budget.json', '{ "check": 40 }\n')
      write('src/__tests__/a.unit.test.ts', "it.skip('works', () => {})\n")
    })
    const ids = content(await session.settle(COMPLETED))
      .split('\n')
      .flatMap((line) => /\[(?<id>[A-Z]+-\d+)\]/u.exec(line)?.groups?.['id'] ?? [])
    expect(ids.slice(1).sort()).toEqual(['GATE-03', 'GATE-03', 'GATE-05'])
  })

  it('blocks a deleted test whose code remains', async () => {
    const session = new AgentGateSession()
    await session.start(root)
    await bash(session, 'rm', () => rmSync(path.join(root, 'src/__tests__/a.unit.test.ts')))
    expect(content(await session.settle(COMPLETED))).toContain(
      'src/__tests__/a.unit.test.ts:1:1 gate/tests [GATE-03] deleted while src/a.ts still exists; restore the test',
    )
  })
})
