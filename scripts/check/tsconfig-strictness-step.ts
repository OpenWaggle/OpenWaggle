/** The check runner step for TS-01: tsconfig changes since origin/main only check more. */
import { bunScript } from './step-helpers'
import type { CheckStep } from './step-model'

export const TSCONFIG_STRICTNESS_STEP: CheckStep = {
  id: 'tsconfig-strictness',
  summary: 'tsconfig changes since origin/main only make type checking stricter',
  commands: [bunScript('scripts/check-tsconfig-strictness.ts')],
  inputs: [
    '**/tsconfig*.json',
    'scripts/check-tsconfig-strictness.ts',
    'scripts/tsconfig-strictness/**',
  ],
  findings: 'lines',
  hint: 'restore the dropped files or flags; a tsconfig change may only check more [TS-01]',
}
