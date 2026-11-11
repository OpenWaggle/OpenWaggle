/** The `no-cheating` check step: nothing since origin/main makes the checks check less. */
import { bunScript } from './step-helpers'
import type { CheckStep } from './step-model'

export const NO_CHEATING_STEP: CheckStep = {
  id: 'no-cheating',
  summary:
    'no change since origin/main checks less: suppressions, tsconfig, lint config, budgets, tests',
  commands: [bunScript('scripts/check-no-cheating.ts')],
  inputs: ['**'],
  findings: 'lines',
  hint: 'fix the code instead of checking less; bun run check:no-cheating',
}
