import { describe, expect, it } from 'vitest'
import { isTestCommand, bashRun } from '../commands'
import { staleDocs } from '../doc-watch'
import { findingSetKey, formatFinding, parseFindingLine, type Finding } from '../findings'
import { ranGenerator } from '../generated-files'
import { newSuppressions } from '../suppressions'
import { affectedProjects, parseTscErrors, typeErrorFindings, typeErrorKey } from '../typecheck'

describe('new suppressions', () => {
  it('reports only the directives the Session added', () => {
    const before = '// @ts-expect-error old\nconst a = 1\n'
    const after =
      '// @ts-expect-error old\nconst a = 1\n/* eslint-disable no-console */\n// biome-ignore lint: x\n'
    expect(newSuppressions('src/a.ts', before, after).map(formatFinding)).toEqual([
      'src/a.ts:3:1 gate/suppressions [TS-08] new eslint-disable comment; fix the code or the shared config instead',
      'src/a.ts:4:1 gate/suppressions [TS-08] new biome-ignore comment; fix the code or the shared config instead',
    ])
  })

  it('counts a new file from empty and skips the rules that name the directives', () => {
    expect(newSuppressions('src/b.tsx', undefined, '{/* @ts-nocheck */}')).toHaveLength(1)
    expect(newSuppressions('scripts/oxlint/rules/x.ts', undefined, '// eslint-disable')).toEqual([])
    expect(newSuppressions('docs/a.md', undefined, '// eslint-disable')).toEqual([])
  })

  it('ignores the words outside a comment', () => {
    expect(newSuppressions('src/a.ts', '', "const name = 'ts-ignore'\n")).toEqual([])
  })
})

describe('shell commands', () => {
  it('recognizes test runs in compound commands', () => {
    for (const command of [
      'bunx vitest run -c vitest.unit.config.ts src/a.unit.test.ts',
      'cd x && bun run test:unit 2>&1 | tail',
      'node_modules/.bin/vitest run scripts/agent-gate',
      'bun run verify',
    ]) {
      expect(isTestCommand(command)).toBe(true)
    }
    for (const command of [
      'bun run lint',
      'vitest --version',
      'cat vitest.config.ts',
      'git commit -m test',
    ]) {
      expect(isTestCommand(command)).toBe(false)
    }
  })

  it('reads the exit status from the bash result', () => {
    expect(bashRun({ command: 'false' }, { exit_code: 1 }, true)).toEqual({
      command: 'false',
      exitCode: 1,
      failed: true,
    })
    expect(bashRun({ command: 'true' }, undefined, false)).toEqual({
      command: 'true',
      exitCode: undefined,
      failed: false,
    })
    expect(bashRun({}, undefined, false)).toBeUndefined()
  })

  it('matches generated files to their generators', () => {
    expect(ranGenerator('bun.lock', ['bun add zod'])).toBe(true)
    expect(ranGenerator('bun.lock', ['sed -i s/a/b/ bun.lock'])).toBe(false)
    expect(
      ranGenerator('scripts/api-snapshots/waggle-core.api.md', ['bun run api:snapshot:update']),
    ).toBe(true)
    expect(ranGenerator('src/renderer/src/routeTree.gen.ts', ['bunx electron-vite build'])).toBe(
      true,
    )
    expect(ranGenerator('src/a.ts', ['bun install'])).toBe(false)
  })
})

describe('doc watch-list', () => {
  const watches = [{ paths: ['scripts/lint.ts'], docs: ['.agents/standards.md'] }]

  it('flags a watched file changed without its doc', () => {
    expect(staleDocs(['scripts/lint.ts'], undefined, watches)).toEqual([
      { file: 'scripts/lint.ts', touched: ['scripts/lint.ts'], docs: ['.agents/standards.md'] },
    ])
  })

  it('passes when the doc changed too, now or earlier in the Session', () => {
    expect(staleDocs(['scripts/lint.ts', '.agents/standards.md'], undefined, watches)).toEqual([])
    expect(staleDocs(['scripts/lint.ts'], ['.agents/standards.md'], watches)).toEqual([])
  })
})

describe('findings', () => {
  const finding: Finding = {
    file: 'src/a.ts',
    line: 2,
    column: 5,
    rule: 'no-empty',
    message: 'Empty.',
    severity: 'block',
  }

  it('round-trips the one-line form', () => {
    const line = 'src/a.ts:2:17 typescript/no-explicit-any [TS-05] Unexpected `any`.'
    const parsed = parseFindingLine(line, 'block')
    expect(parsed?.id).toBe('TS-05')
    expect(parsed === undefined ? '' : formatFinding(parsed)).toBe(line)
    expect(parseFindingLine('Error: oxlint crashed', 'block')).toBeUndefined()
  })

  it('keys a finding set without its positions', () => {
    expect(findingSetKey([finding])).toBe(findingSetKey([{ ...finding, line: 40 }]))
    expect(findingSetKey([finding])).not.toBe(findingSetKey([{ ...finding, message: 'Other.' }]))
  })
})

describe('project type check', () => {
  it('maps changed files to the projects that check them', () => {
    expect(affectedProjects(['src/main/a.ts'])).toEqual(['node'])
    expect(affectedProjects(['src/renderer/src/a.tsx'])).toEqual(['web'])
    expect(affectedProjects(['src/shared/a.ts'])).toEqual(['node', 'web'])
    expect(affectedProjects(['src/renderer/src/a.test.tsx', 'README.md'])).toEqual([])
  })

  it('blocks errors in changed files and new errors elsewhere', () => {
    const errors = parseTscErrors(
      "src/main/a.ts(3,7): error TS2322: Type 'string' is not assignable to type 'number'.\n" +
        'src/main/b.ts(1,1): error TS2304: Cannot find name x.\n' +
        'src/main/c.ts(2,2): error TS2304: Cannot find name y.\n',
    )
    expect(errors).toHaveLength(3)
    const known = new Set(errors.slice(2).map(typeErrorKey))
    expect(
      typeErrorFindings(errors, ['src/main/a.ts'], known).map((finding) => [
        finding.file,
        finding.severity,
      ]),
    ).toEqual([
      ['src/main/a.ts', 'block'],
      ['src/main/b.ts', 'block'],
    ])
    expect(
      typeErrorFindings(errors, ['src/main/a.ts'], undefined).map((finding) => finding.severity),
    ).toEqual(['block', 'advisory', 'advisory'])
  })
})
