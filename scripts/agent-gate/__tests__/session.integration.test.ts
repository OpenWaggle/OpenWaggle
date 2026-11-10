import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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
  writeFileSync(path.join(root, file), text)
}

/** One bash call that runs `effect` between the gate's before and after hooks. */
async function bash(session: AgentGateSession, command: string, effect: () => void, exitCode = 0) {
  calls += 1
  const call: ToolCall = { id: `call-${calls}`, name: 'bash', input: { command } }
  await session.beforeTool(call)
  effect()
  return session.afterTool({
    ...call,
    isError: exitCode !== 0,
    structuredContent: { exit_code: exitCode },
  })
}

const COMPLETED = { outcome: 'completed', canContinue: true } as const

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'agent-gate-'))
  git('init', '-q')
  git('config', 'user.email', 'gate@example.com')
  git('config', 'user.name', 'Gate')
  write('package.json', JSON.stringify({ name: 'x', dependencies: { a: '1.0.0' } }, null, 2))
  write('tsconfig.json', '{ "compilerOptions": { "strict": true }, "include": ["src"] }')
  write(
    'DEPENDENCIES.md',
    '| Package | Pin | Reason | Last known good |\n| --- | --- | --- | --- |\n',
  )
  execFileSync('mkdir', ['-p', 'src'], { cwd: root })
  write('src/a.ts', 'export const a = 1\n')
  git('add', '-A')
  git('commit', '-q', '-m', 'init')
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('agent gate Session', () => {
  it('catches a shell edit, blocks once, then hands the same findings to the user', async () => {
    const session = new AgentGateSession()
    await session.start(root)
    await bash(session, "printf '// @ts-ignore\\n' >> src/a.ts", () =>
      write('src/a.ts', 'export const a = 1\n// @ts-ignore\n'),
    )

    const first = await session.settle(COMPLETED)
    expect(first?.kind).toBe('block')
    const lines = first?.content?.split('\n') ?? []
    expect(lines).toContain(
      'src/a.ts:2:1 gate/suppressions [TS-08] new @ts-ignore comment; fix the code or the shared config instead',
    )
    expect(lines).toContain(
      'src/a.ts:1:1 gate/tests [TEST-05] changed with no test run since; run the tests that cover them',
    )
    // No lint tools in the scratch repository: one advisory line each, never a block.
    expect(lines.filter((line) => line.startsWith('gate: '))).toHaveLength(2)

    expect((await session.settle(COMPLETED))?.kind).toBe('handoff')
    expect(await session.settle(COMPLETED)).toEqual({ kind: 'pass', content: expect.any(String) })
  })

  it('passes after the fix and a passing test run, keeping tool-failed files for the next gate', async () => {
    const session = new AgentGateSession()
    await session.start(root)
    await bash(session, 'edit', () => write('src/a.ts', 'export const a = 2\n'))
    await bash(session, 'bunx vitest run src', () => undefined)
    const decision = await session.settle(COMPLETED)
    expect(decision?.kind).toBe('pass')
    expect(decision?.content).toContain('stays unchecked')
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
    const decision = await session.settle(COMPLETED)
    expect(decision?.content).toContain(
      'bun.lock:1:1 gate/generated [TOOL-07] Bun lockfile changed by the edit tool',
    )
  })

  it('asks the user about a weaker tsconfig and blocks when they refuse', async () => {
    const asked: string[] = []
    const session = new AgentGateSession({
      ask: (title) => (asked.push(title), Promise.resolve(false)),
    })
    await session.start(root)
    const note = await bash(session, 'edit tsconfig', () =>
      write('tsconfig.json', '{ "compilerOptions": { "strict": false }, "include": ["src"] }'),
    )
    expect(asked).toEqual(['Allow a weaker tsconfig.json?'])
    expect(note).toContain('revert it [TS-01]')
    const decision = await session.settle(COMPLETED)
    expect(decision?.content).toContain('tsconfig.json:1:1 gate/tsconfig [TS-01] strict weakened')
  })

  it('needs approval and a DEPENDENCIES.md row for a new dependency behind latest', async () => {
    const session = new AgentGateSession({
      ask: () => Promise.resolve(undefined),
      latest: () => Promise.resolve('2.0.0'),
    })
    await session.start(root)
    await bash(session, 'edit package.json', () =>
      write(
        'package.json',
        JSON.stringify({ name: 'x', dependencies: { a: '1.0.0', b: '1.0.0', c: '^1.0.0' } }),
      ),
    )
    const content = (await session.settle(COMPLETED))?.content ?? ''
    expect(content).toContain(
      "package.json:1:1 gate/dependencies [DEP-02] b@1.0.0 added without the user's approval",
    )
    expect(content).toMatch(/DEPENDENCIES\.md:1:1 gate\/dependencies \[DEP-03\] .*\bb\b/u)
    expect(content).toMatch(/package\.json:1:1 gate\/dependencies \[DEP-01\] .*\bc\b/u)
  })

  it('counts a package named in a user prompt as approved', async () => {
    const session = new AgentGateSession({ latest: () => Promise.resolve('1.0.0') })
    await session.start(root)
    session.notePrompt('please add b to the dependencies')
    await bash(session, 'bun add b', () =>
      write(
        'package.json',
        JSON.stringify({ name: 'x', dependencies: { a: '1.0.0', b: '1.0.0' } }),
      ),
    )
    const content = (await session.settle(COMPLETED))?.content ?? ''
    expect(content).not.toContain('DEP-02')
    expect(content).not.toContain('DEP-03')
  })
})
