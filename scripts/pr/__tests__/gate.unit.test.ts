import { describe, expect, it } from 'vitest'
import { failedTestFiles } from '../gate'

describe('the failed test files the ready gate reruns', () => {
  it.each([
    [
      'a test that timed out, with its tier config',
      'src/main/ipc/git/__tests__/push-destination.integration.test.ts:373:30 FAIL where a push lands > x',
      [
        {
          file: 'src/main/ipc/git/__tests__/push-destination.integration.test.ts',
          config: 'vitest.integration.config.ts',
        },
      ],
    ],
    [
      'each file once, in the order it first failed',
      [
        'src/a.unit.test.ts:1:1 FAIL one',
        'src/b.component.test.tsx:2:3 FAIL two',
        'src/a.unit.test.ts:9:1 FAIL three',
      ].join('\n'),
      [
        { file: 'src/a.unit.test.ts', config: 'vitest.unit.config.ts' },
        { file: 'src/b.component.test.tsx', config: 'vitest.component.config.ts' },
      ],
    ],
    [
      'a file the temporary-directory guard failed',
      'scripts/test-support/temporary-directory-guard.ts:97:13 FAIL src/main/x.integration.test.ts (file failed)',
      [{ file: 'src/main/x.integration.test.ts', config: 'vitest.integration.config.ts' }],
    ],
    ['nothing for a failure that names no test file', 'mcp conformance: 1 scenario failed', []],
    ['nothing for a passing summary', 'vitest: 2 failed, 1445 passed (349 files)', []],
  ])('finds %s', (_name, log, expected) => {
    expect(failedTestFiles(log)).toEqual(expected)
  })
})
