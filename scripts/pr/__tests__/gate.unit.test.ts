import { describe, expect, it } from 'vitest'
import { rerunCandidates, testSteps } from '../gate'

describe('the test files the ready gate reruns alone', () => {
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
    [
      'a file that failed at import',
      'src/x.unit.test.ts:3:1 FAIL src/x.unit.test.ts (file failed)',
      ['src/x.unit.test.ts'],
    ],
    [
      'no file for an indented line that only looks like a failure',
      ['src/a.unit.test.ts:1:1 FAIL one', '  src/b.unit.test.ts:2:2 FAIL printed by a test'].join(
        '\n',
      ),
      ['src/a.unit.test.ts'],
    ],
  ])('finds %s', (_name, log, expected) => {
    expect(rerunCandidates(log)).toEqual(expected)
  })

  it.each([
    [
      'a failure whose frame is in a helper, next to a named one',
      ['src/a.unit.test.ts:1:1 FAIL one', 'src/x/helper.ts:2:100 FAIL async helper fails'].join(
        '\n',
      ),
    ],
    [
      'an unhandled error line',
      ['src/a.unit.test.ts:1:1 FAIL one', ':1:1 FAIL unhandled error'].join('\n'),
    ],
    [
      'an unhandled error in the summary',
      ['src/a.unit.test.ts:1:1 FAIL one', 'vitest: 1 failed, 1 unhandled error'].join('\n'),
    ],
    ['a failure that names no test file', 'mcp conformance: 1 scenario failed'],
    ['a summary line alone', 'vitest: 2 failed, 1445 passed (349 files)'],
  ])('reruns nothing for %s', (_name, log) => {
    expect(rerunCandidates(log)).toBeUndefined()
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

  it('gives no config to a step that runs more than Vitest, so a rerun cannot skip its later parts', () => {
    expect(
      testSteps({
        test: 'bun run test:local',
        'test:local':
          'bun --bun vitest run -c vitest.unit.config.ts && bun --bun vitest run -c vitest.component.config.ts',
      }),
    ).toEqual([{ name: 'test:local', config: undefined }])
  })

  it.each([
    ['a step that is not `bun run <script>`', { test: 'bun run a && vitest run', a: 'echo' }],
    ['a step naming a missing script', { test: 'bun run missing' }],
    ['no test script', { build: 'echo' }],
  ])('refuses %s', (_name, scripts) => {
    expect(() => testSteps(scripts)).toThrow()
  })
})
