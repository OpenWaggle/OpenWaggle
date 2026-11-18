import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  nodeRuntimeVitestArguments,
  workflowNodeScripts,
  workflowNodeScriptTests,
} from '../node-runtime-tests'

const ROOT = process.cwd()

describe('workflowNodeScripts', () => {
  it('finds scripts run under node, with flags and from the release tooling checkout', () => {
    const workflow = [
      '        run: node scripts/macos-build-failure.ts "$LOG"',
      '        run: node --disable-warning=X scripts/package-release-plan.ts a b',
      '        run: node --flag .release-tooling/scripts/package-consumer-tools.ts install',
      '          if ! REASON="$(node scripts/app-release-notes.ts write)"; then',
      '        run: bun scripts/check/run.ts',
      '        run: node -p "require(\'./package.json\').version"',
      '        run: node node_modules/vitest/vitest.mjs run',
    ].join('\n')
    expect(workflowNodeScripts([workflow])).toEqual([
      'app-release-notes',
      'macos-build-failure',
      'package-consumer-tools',
      'package-release-plan',
    ])
  })
})

describe('the Node.js test run', () => {
  // The release scripts the workflows run under plain node were tested only on Bun.
  it('runs the tests of every script a workflow runs under node', () => {
    const unit = workflowNodeScriptTests(ROOT, 'unit')
    const integration = workflowNodeScriptTests(ROOT, 'integration')
    expect(unit.map(({ script }) => script)).toEqual(
      expect.arrayContaining([
        'package-release-plan',
        'verify-release-assets',
        'macos-build-failure',
      ]),
    )
    const untested = unit.flatMap(({ script, tests }, index) =>
      tests.length + (integration[index]?.tests.length ?? 0) === 0 ? [script] : [],
    )
    expect(untested).toEqual([])
    for (const tier of ['unit', 'integration'] as const) {
      const vitestArguments = nodeRuntimeVitestArguments(ROOT, tier)
      for (const { tests } of workflowNodeScriptTests(ROOT, tier)) {
        expect(vitestArguments).toEqual(expect.arrayContaining(tests))
      }
    }
  })

  it('is what the test:node-runtime scripts run', () => {
    const packageJson: unknown = JSON.parse(fs.readFileSync('package.json', 'utf8'))
    expect(packageJson).toMatchObject({
      scripts: {
        'test:node-runtime:raw': 'bun scripts/node-runtime-tests.ts unit',
        'test:node-runtime:integration:raw': 'bun scripts/node-runtime-tests.ts integration',
      },
    })
  })
})
