import { describe, expect, it } from 'vitest'
import { failedTestFiles, testSteps } from '../gate'

describe('the failed test files the ready gate reruns', () => {
  it.each([
    [
      'a test that timed out',
      'src/main/ipc/git/__tests__/push-destination.integration.test.ts:373:30 FAIL where a push lands > x',
      ['src/main/ipc/git/__tests__/push-destination.integration.test.ts'],
    ],
    [
      'each file once, in the order it first failed',
      [
        'src/a.unit.test.ts:1:1 FAIL one',
        'packages/b/src/b.test.tsx:2:3 FAIL two',
        'src/a.unit.test.ts:9:1 FAIL three',
      ].join('\n'),
      ['src/a.unit.test.ts', 'packages/b/src/b.test.tsx'],
    ],
    [
      'a file the temporary-directory guard failed',
      'scripts/test-support/temporary-directory-guard.ts:97:13 FAIL src/main/x.integration.test.ts (file failed)',
      ['src/main/x.integration.test.ts'],
    ],
    ['nothing for a failure that names no test file', 'mcp conformance: 1 scenario failed', []],
    ['nothing for a summary line', 'vitest: 2 failed, 1445 passed (349 files)', []],
  ])('finds %s', (_name, log, expected) => {
    expect(failedTestFiles(log)).toEqual(expected)
  })
})

describe('the steps of the test script the ready gate runs one by one', () => {
  it('lists every chained step with the Vitest config it runs', () => {
    expect(
      testSteps({
        test: 'bun run prepare && bun run test:unit:raw && bun run test:mcp',
        prepare: 'bun scripts/rebuild-native-deps.ts node',
        'test:unit:raw': 'X=true bun --bun vitest run -c vitest.unit.config.ts',
        'test:mcp': 'conformance client --scenario initialize',
      }),
    ).toEqual([
      { name: 'prepare', config: undefined },
      { name: 'test:unit:raw', config: 'vitest.unit.config.ts' },
      { name: 'test:mcp', config: undefined },
    ])
  })

  it.each([
    ['a step that is not `bun run <script>`', { test: 'bun run a && vitest run', a: 'echo' }],
    ['a step naming a missing script', { test: 'bun run missing' }],
    ['no test script', { build: 'echo' }],
  ])('refuses %s', (_name, scripts) => {
    expect(() => testSteps(scripts)).toThrow()
  })
})
