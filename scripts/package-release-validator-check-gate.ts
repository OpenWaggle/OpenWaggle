/**
 * The package release gates inside the check runner's step graph (scripts/check/steps.ts): `bun run
 * check` must smoke the packed packages after building every package, and type-aware lint must run
 * after the package builds it resolves through node_modules on a clean checkout.
 */
import type { CheckGate, CheckStep } from './check/step-model'

export const CHECK_RUNNER_SCRIPT = 'bun scripts/check/run.ts check'
const CHECK_RUNNER_PREFIX = 'bun scripts/check/run.ts'
const PACKAGE_SMOKE_STEP = 'package-smoke'
const LINT_STEP = 'lint'
const PACKAGE_BUILD_STEPS = [
  'build:waggle-core',
  'build:extension-sdk',
  'build:pi-waggle',
  'build:extension-react',
]
const PACKAGE_DEPENDENCY_BUILD_STEPS = ['build:waggle-core', 'build:extension-sdk']

function dependsOnAll(step: CheckStep | undefined, ids: readonly string[]) {
  return step !== undefined && ids.every((id) => (step.dependsOn ?? []).includes(id))
}

export function validateCheckGate(steps: readonly CheckStep[], gates: readonly CheckGate[]) {
  const violations: string[] = []
  const byId = new Map(steps.map((step) => [step.id, step]))
  const smoke = byId.get(PACKAGE_SMOKE_STEP)
  const checkGate = gates.find((gate) => gate.id === 'check')
  const runsSmoke =
    checkGate?.steps.includes(PACKAGE_SMOKE_STEP) === true &&
    smoke?.commands.some((command) => command.some((part) => part.endsWith('package-smoke.ts'))) ===
      true
  if (!runsSmoke) {
    violations.push(
      `scripts/check/steps.ts: the check gate must run the ${PACKAGE_SMOKE_STEP} step (scripts/package-smoke.ts).`,
    )
  }
  if (!dependsOnAll(smoke, PACKAGE_BUILD_STEPS)) {
    violations.push(
      `scripts/check/steps.ts: ${PACKAGE_SMOKE_STEP} must depend on ${PACKAGE_BUILD_STEPS.join(', ')}.`,
    )
  }
  if (!dependsOnAll(byId.get(LINT_STEP), PACKAGE_DEPENDENCY_BUILD_STEPS)) {
    violations.push(
      `scripts/check/steps.ts: ${LINT_STEP} must depend on ${PACKAGE_DEPENDENCY_BUILD_STEPS.join(', ')} for clean-checkout type-aware analysis.`,
    )
  }
  return violations
}

/** `bun run lint` goes through the runner, whose lint step the graph check above covers. */
export function runsRunnerLint(script: unknown) {
  return (
    typeof script === 'string' &&
    script.startsWith(CHECK_RUNNER_PREFIX) &&
    /(?:^|[\s,=])lint(?:$|[\s,])/u.test(script)
  )
}
