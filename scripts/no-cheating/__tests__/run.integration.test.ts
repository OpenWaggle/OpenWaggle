import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { formatFinding } from '../findings'
import { noCheatingFindings } from '../run'

let root = ''

function git(...args: string[]) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
}

function write(file: string, text: string) {
  mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
  writeFileSync(path.join(root, file), text)
}

async function findings(base: string) {
  return (await noCheatingFindings(root, base)).map(formatFinding)
}

const TEST = "import { it } from 'vitest'\nit('works', () => {})\n"

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'no-cheating-'))
  git('init', '-q')
  git('config', 'user.email', 'check@example.com')
  git('config', 'user.name', 'Check')
  write('.gitignore', 'node_modules/\n')
  write('tsconfig.json', '{ "compilerOptions": { "strict": true }, "include": ["src"] }\n')
  write('src/a.ts', 'export const a = 1\n')
  write('src/__tests__/a.unit.test.ts', TEST)
  write('src/__tests__/flows.integration.test.ts', TEST)
  write('oxlint.config.mts', "export default {\n  rules: {\n    'no-console': 'error',\n  },\n}\n")
  write('scripts/check/output-budget.json', '{ "check": 20 }\n')
  write('website/public/schemas/mcp.schema.json', '{}\n')
  git('add', '-A')
  git('commit', '-q', '-m', 'init')
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('no-cheating', () => {
  it('passes a clean tree and a stricter tsconfig', async () => {
    expect(await findings('HEAD')).toEqual([])
    write(
      'tsconfig.json',
      '{ "compilerOptions": { "strict": true, "noUncheckedIndexedAccess": true }, "include": ["src"] }\n',
    )
    expect(await findings('HEAD')).toEqual([])
  })

  it('reports each way of checking less, committed or not, against the base', async () => {
    const base = git('rev-parse', 'HEAD')
    write('src/a.ts', 'export const a = 1 as any\n// @ts-ignore\n')
    write('tsconfig.json', '{ "compilerOptions": { "strict": false }, "include": ["src"] }\n')
    write('oxlint.config.mts', "export default {\n  rules: {\n    'no-console': 'off',\n  },\n}\n")
    git('commit', '-qam', 'loosen')
    write('scripts/check/output-budget.json', '{ "check": 40 }\n')
    write('src/__tests__/a.unit.test.ts', TEST.replace("it('works'", "it.skip('works'"))
    rmSync(path.join(root, 'src/__tests__/flows.integration.test.ts'))
    expect((await findings(base)).sort()).toEqual([
      'oxlint.config.mts:3 [no-cheating/lint-config] rule turned off or down to a warning with no comment saying why; fix the code, or add the reason above the entry',
      'scripts/check/output-budget.json:1 [no-cheating/budget] check output budget check moved from 20 to 40; get under it instead',
      'src/__tests__/a.unit.test.ts:2 [no-cheating/test] new skip on a test; run it and fix what fails',
      'src/__tests__/flows.integration.test.ts:1 [no-cheating/test] test file deleted without the code it covers; restore it',
      'src/a.ts:1 [no-cheating/cast] new `as any` cast; type the value instead',
      'src/a.ts:2 [no-cheating/suppression] new @ts-ignore comment; fix the code or the shared config instead',
      'tsconfig.json:1 [no-cheating/tsconfig] strict, noImplicitAny, strictNullChecks, strictFunctionTypes, strictBindCallApply, strictPropertyInitialization, strictBuiltinIteratorReturn, noImplicitThis, useUnknownInCatchVariables, alwaysStrict check less on 2 files: src/__tests__/a.unit.test.ts, src/a.ts; a tsconfig change may only check more',
    ])
  })

  it('passes a moved test and flags a hand-edited generated file', async () => {
    git('mv', 'src/__tests__/flows.integration.test.ts', 'src/__tests__/flow.integration.test.ts')
    write('website/public/schemas/mcp.schema.json', '{ "edited": true }\n')
    expect(await findings('HEAD')).toEqual([
      'website/public/schemas/mcp.schema.json:1 [no-cheating/generated-file] differs from what its generator writes; run `bun run website:schemas` instead of editing it',
    ])
  })
})
