/**
 * The steps that run tests: the advisory `coverage-uniqueness` step, which names a test file this
 * branch adds that covers nothing the nightly index has no other test covering (.agents/standards.md,
 * Testing) and fails nothing (`scripts/coverage-uniqueness.ts`, `test-advisory.yml`), and the unit
 * tier with the native modules it loads.
 */
import { bunRuntimePackageBin, bunScript } from './step-helpers'
import type { CheckStep } from './step-model'

export const TEST_STEPS: readonly CheckStep[] = [
  {
    id: 'coverage-uniqueness',
    summary: 'advisory, fails nothing: a new test file that covers nothing the nightly index lacks',
    commands: [bunScript('scripts/coverage-uniqueness.ts', 'advise')],
    inputs: [
      '**/*.test.ts',
      '**/*.test.tsx',
      'scripts/coverage-uniqueness.ts',
      'scripts/coverage-uniqueness/**',
    ],
    findings: 'lines',
    hint: 'zero unique coverage is a candidate, not a verdict: see Testing in .agents/standards.md',
    advisory: true,
  },
  {
    id: 'native-node',
    summary: 'native modules built for Node (cached)',
    commands: [bunScript('scripts/rebuild-native-deps.ts')],
    inputs: ['bun.lock'],
    findings: 'generic',
    hint: 'bun run prepare:native:node',
  },
  {
    id: 'test-unit',
    summary: 'unit tests (vitest.unit.config.ts)',
    commands: [[...bunRuntimePackageBin('vitest', 'vitest'), 'run', '-c', 'vitest.unit.config.ts']],
    dependsOn: ['native-node'],
    inputs: ['**'],
    findings: 'vitest',
    hint: 'rerun one file: bun run test:unit:raw <file>',
  },
]
