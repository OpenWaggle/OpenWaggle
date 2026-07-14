import { readFile } from 'node:fs/promises'
import path from 'node:path'
import {
  readReleaseCiWorkflowJobs,
  type ReleaseCiWorkflowJob,
} from './release-ci-policy-workflow'

export const REQUIRED_CI_CHECKS = [
  'Commit Policy',
  'Typecheck & Lint',
  'Unit & Component Tests',
] as const
const PACKAGE_CONSUMER_CI_JOB = 'Package Consumer Tools (Node ${{ matrix.node }})'
const EXPECTED_CI_JOBS = [PACKAGE_CONSUMER_CI_JOB, ...REQUIRED_CI_CHECKS] as const

const CI_WORKFLOW_PATH = '.github/workflows/ci.yml'
const CONCURRENCY_POLICY_FIELD_COUNT = 2
const REQUIRED_JOB_KEYS = ['name', 'runs-on', 'steps'] as const
const ACTION_CHECKOUT = 'actions/checkout@df4cb1c069e1874edd31b4311f1884172cec0e10 # v6'
const ACTION_SETUP_NODE = 'actions/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e # v6'
const PNPM_ACTION_SETUP = 'pnpm/action-setup@b906affcce14559ad1aafd4ab0e942779e9f58b1 # v4'
const IMMUTABLE_ACTIONS = [ACTION_CHECKOUT, PNPM_ACTION_SETUP, ACTION_SETUP_NODE] as const
const CONCURRENCY_GROUP =
  'group: ci-${{ github.workflow }}-${{ github.event.pull_request.number || inputs.head_sha || github.ref }}'
const DISPATCH_GUARD_STEP = `      - name: Verify dispatched commit identity
        if: github.event_name == 'workflow_dispatch'
        env:
          DISPATCHED_SHA: \${{ github.sha }}
          EXPECTED_SHA: \${{ inputs.head_sha }}
        run: |
          [[ "$EXPECTED_SHA" =~ ^[0-9a-f]{40}$ ]]
          test "$DISPATCHED_SHA" = "$EXPECTED_SHA"`
const CHECKOUT_STEP = `      - uses: ${ACTION_CHECKOUT}
        with:
          ref: \${{ github.event_name == 'workflow_dispatch' && inputs.head_sha || github.sha }}`
const COMMIT_POLICY_CHECKOUT_STEP = `      - uses: ${ACTION_CHECKOUT}
        with:
          fetch-depth: 0
          ref: \${{ github.event_name == 'workflow_dispatch' && inputs.head_sha || github.sha }}`
const PNPM_SETUP_STEP = `      - uses: ${PNPM_ACTION_SETUP}`
const NODE_SETUP_STEP = `      - uses: ${ACTION_SETUP_NODE}
        with:
          node-version: 24
          cache: pnpm`
const INSTALL_STEP = '      - run: pnpm install --frozen-lockfile'
const RELEASE_POLICY_STEP = '      - run: pnpm exec tsx scripts/release-ci-policy.ts'
const CONVENTIONAL_COMMITS_STEP = `      - name: Validate Conventional Commits
        env:
          COMMIT_POLICY_FROM: \${{ github.event_name == 'push' && github.event.before || github.event_name == 'pull_request' && github.event.pull_request.base.sha || '' }}
          COMMIT_POLICY_TO: \${{ github.event_name == 'workflow_dispatch' && inputs.head_sha || github.event_name == 'pull_request' && github.event.pull_request.head.sha || github.sha }}
          PR_TITLE: \${{ github.event_name == 'pull_request' && github.event.pull_request.title || '' }}
        run: pnpm exec tsx scripts/check-conventional-commits.ts --from "$COMMIT_POLICY_FROM" --to "$COMMIT_POLICY_TO" --pr-title "$PR_TITLE"`

const EXPECTED_STEPS = new Map<string, readonly string[]>([
  [
    'Commit Policy',
    [
      DISPATCH_GUARD_STEP,
      COMMIT_POLICY_CHECKOUT_STEP,
      PNPM_SETUP_STEP,
      NODE_SETUP_STEP,
      INSTALL_STEP,
      RELEASE_POLICY_STEP,
      CONVENTIONAL_COMMITS_STEP,
    ],
  ],
  [
    'Typecheck & Lint',
    [
      DISPATCH_GUARD_STEP,
      CHECKOUT_STEP,
      PNPM_SETUP_STEP,
      NODE_SETUP_STEP,
      INSTALL_STEP,
      '      - run: pnpm check',
    ],
  ],
  [
    'Unit & Component Tests',
    [
      DISPATCH_GUARD_STEP,
      CHECKOUT_STEP,
      PNPM_SETUP_STEP,
      NODE_SETUP_STEP,
      INSTALL_STEP,
      '      - run: pnpm test',
    ],
  ],
])

function hasMainBranchTrigger(workflow: string, trigger: string) {
  return new RegExp(`^ {2}${trigger}:\\s*\\n {4}branches: \\[main\\]$`, 'm').test(workflow)
}

function readJobKeys(job: ReleaseCiWorkflowJob) {
  return job.keys
}

function readSteps(job: ReleaseCiWorkflowJob) {
  const starts = [...job.block.matchAll(/^ {6}- /gm)].flatMap((match) =>
    match.index === undefined ? [] : [match.index],
  )

  return starts.map((start, index) =>
    job.block.slice(start, starts[index + 1] ?? job.block.length).trimEnd(),
  )
}

function readTopLevelSection(workflow: string, sectionName: string) {
  const lines = workflow.split('\n')
  const sectionStart = lines.indexOf(`${sectionName}:`)
  if (sectionStart === -1) return []

  const values: string[] = []
  for (let index = sectionStart + 1; index < lines.length; index += 1) {
    const line = lines[index]
    if (line === undefined || (line.length > 0 && !line.startsWith(' '))) break
    if (line.trim().length > 0) values.push(line.trim())
  }

  return values
}

function isRequiredCheck(name: string): name is (typeof REQUIRED_CI_CHECKS)[number] {
  return REQUIRED_CI_CHECKS.some((checkName) => checkName === name)
}

function validateTriggers(workflow: string, violations: string[]) {
  if (!hasMainBranchTrigger(workflow, 'push')) violations.push('CI must run on pushes to main.')
  if (!hasMainBranchTrigger(workflow, 'pull_request')) {
    violations.push('CI must run on pull requests targeting main.')
  }
}

function validateDispatchSupport(
  workflow: string,
  jobs: readonly ReleaseCiWorkflowJob[],
  violations: string[],
) {
  const dispatchInput = /^ {2}workflow_dispatch:\s*\n {4}inputs:\s*\n {6}head_sha:\s*\n(?: {8}.+\n)*? {8}required: true\s*\n {8}type: string$/m
  if (!dispatchInput.test(workflow)) {
    violations.push('CI must accept a required workflow_dispatch head_sha input.')
  }

  const requiredJobs = jobs.filter((job) => isRequiredCheck(job.name))
  const guardedJobs = requiredJobs.filter((job) => readSteps(job)[0] === DISPATCH_GUARD_STEP)
  const checkoutJobs = requiredJobs.filter((job) =>
    readSteps(job).some(
      (step) => step === CHECKOUT_STEP || step === COMMIT_POLICY_CHECKOUT_STEP,
    ),
  )

  if (checkoutJobs.length !== REQUIRED_CI_CHECKS.length) {
    violations.push('CI must check out inputs.head_sha for workflow_dispatch validation.')
  }
  if (guardedJobs.length !== REQUIRED_CI_CHECKS.length) {
    violations.push(
      'CI workflow_dispatch must verify github.sha matches the immutable inputs.head_sha SHA.',
    )
    violations.push(
      'CI workflow_dispatch must validate inputs.head_sha as a canonical commit SHA in every required job.',
    )
  }

  for (const job of requiredJobs) {
    const steps = readSteps(job)
    const hasContract =
      steps[0] === DISPATCH_GUARD_STEP &&
      steps.some((step) => step === CHECKOUT_STEP || step === COMMIT_POLICY_CHECKOUT_STEP)
    if (!hasContract) {
      violations.push(`CI job ${job.name} must independently guard and check out inputs.head_sha.`)
    }
  }
}

function validateCommitPolicy(workflow: string, violations: string[]) {
  if (workflow.includes('chore(release):')) {
    violations.push('CI must not skip release commits; release commits require the same checks.')
  }
}

function validateConcurrency(workflow: string, violations: string[]) {
  const concurrency = readTopLevelSection(workflow, 'concurrency')
  if (
    concurrency.length !== CONCURRENCY_POLICY_FIELD_COUNT ||
    concurrency[0] !== CONCURRENCY_GROUP ||
    concurrency[1] !== 'cancel-in-progress: true'
  ) {
    violations.push(
      'CI concurrency must isolate workflow_dispatch runs by inputs.head_sha and cancel stale duplicate work.',
    )
  }
}

function validateSecurity(
  workflow: string,
  jobs: readonly ReleaseCiWorkflowJob[],
  violations: string[],
) {
  const permissions = readTopLevelSection(workflow, 'permissions')
  if (permissions.length !== 1 || permissions[0] !== 'contents: read') {
    violations.push('CI must grant only read access to repository contents.')
  }

  for (const action of IMMUTABLE_ACTIONS) {
    const actionLine = `      - uses: ${action}`
    if (jobs.flatMap(readSteps).filter((step) => step.startsWith(actionLine)).length !== REQUIRED_CI_CHECKS.length) {
      violations.push(`CI must use ${action} in every required job.`)
    }
  }

  const mutableActionReference = /^\s*- uses: [^\s#]+@(?![0-9a-f]{40}(?:\s+#|$))/m
  if (mutableActionReference.test(workflow)) {
    violations.push('CI actions must be pinned to immutable full commit SHAs.')
  }

  for (const job of jobs) {
    if (!isRequiredCheck(job.name)) continue
    const steps = readSteps(job)
    for (const action of IMMUTABLE_ACTIONS) {
      const actionLine = `      - uses: ${action}`
      if (steps.filter((step) => step.startsWith(actionLine)).length !== 1) {
        violations.push(`CI job ${job.name} must use ${action} exactly once.`)
      }
    }
  }
}

function validateRequiredJobContract(job: ReleaseCiWorkflowJob, violations: string[]) {
  if (!isRequiredCheck(job.name)) return
  const jobKeys = readJobKeys(job)
  const hasExactJobContract =
    jobKeys.length === REQUIRED_JOB_KEYS.length &&
    REQUIRED_JOB_KEYS.every((key) => jobKeys.includes(key)) &&
    /^ {4}runs-on: ubuntu-latest$/m.test(job.block)
  if (!hasExactJobContract) {
    violations.push(
      `CI job ${job.name} must keep the exact blocking job contract: name, ubuntu-latest runner, and steps only.`,
    )
  }
}

function validateRequiredChecks(
  workflow: string,
  jobs: readonly ReleaseCiWorkflowJob[],
  violations: string[],
) {
  const jobNames = jobs.map((job) => job.name)
  if (
    jobNames.length !== EXPECTED_CI_JOBS.length ||
    EXPECTED_CI_JOBS.some((checkName) => !jobNames.includes(checkName))
  ) {
    violations.push(
      `CI must expose exactly these stable job names: ${EXPECTED_CI_JOBS.join(', ')}.`,
    )
  }
  if (/^ {4}if:/m.test(workflow)) {
    violations.push('CI required jobs must run unconditionally for every configured trigger.')
  }
  if (/^ {8}continue-on-error:/m.test(workflow)) {
    violations.push('CI required steps must not use continue-on-error.')
  }
  if (/^(?:defaults:| {4}defaults:)/m.test(workflow)) {
    violations.push('CI must not override the default shell for required steps.')
  }

  for (const job of jobs) {
    validateRequiredJobContract(job, violations)
    const expected = EXPECTED_STEPS.get(job.name)
    if (expected === undefined) continue
    const actual = readSteps(job)
    if (actual.length === expected.length && actual.every((step, index) => step === expected[index])) {
      continue
    }

    const requiredCommand =
      job.name === 'Typecheck & Lint'
        ? 'pnpm check'
        : job.name === 'Unit & Component Tests'
          ? 'pnpm test'
          : undefined
    if (requiredCommand !== undefined) {
      const exactStep = `      - run: ${requiredCommand}`
      if (!actual.includes(exactStep)) {
        violations.push(`CI job ${job.name} must run ${requiredCommand} as an exact, fail-closed step.`)
      }
    }
    violations.push(`CI job ${job.name} steps must match the fail-closed required sequence.`)
  }
}

export function validateReleaseCiPolicy(workflow: string) {
  const violations: string[] = []
  const jobs = readReleaseCiWorkflowJobs(workflow)

  validateTriggers(workflow, violations)
  validateDispatchSupport(workflow, jobs, violations)
  validateCommitPolicy(workflow, violations)
  validateConcurrency(workflow, violations)
  validateSecurity(workflow, jobs, violations)
  validateRequiredChecks(workflow, jobs, violations)

  return violations
}

async function main() {
  const workflowPath = path.join(process.cwd(), CI_WORKFLOW_PATH)
  const violations = validateReleaseCiPolicy(await readFile(workflowPath, 'utf8'))

  if (violations.length === 0) {
    console.log('Release CI policy passed.')
    return
  }

  console.error(violations.join('\n'))
  process.exitCode = 1
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main().catch((error: unknown) => {
    console.error(String(error))
    process.exitCode = 1
  })
}
