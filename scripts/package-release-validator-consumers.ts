import { runsExactCommand } from './package-release-validator-workflow-structure'
import {
  jobExactNamedActionStepWithInputsIndex,
  jobExactNamedRunStepIndex,
  jobHasConditionalExactRunStepWithEnv,
  jobHasDedicatedExactRunStep,
  jobHasDedicatedExactRunStepWithEnv,
  workflowJobCondition,
  workflowJobFailFast,
  workflowJobHasOnlyKeys,
  workflowJobHasExactSteps,
  workflowJobMatrixHasOnlyKeys,
  workflowJobMatrixValues,
  workflowJobNeeds,
  workflowJobRunsOn,
  workflowJobRunCommands,
  workflowJobStrategyHasOnlyKeys,
  workflowHasKey,
} from './package-release-validator-workflow-steps'
import type { WorkflowStepContract } from './package-release-validator-workflow-steps'

const JOB_INDENT_WIDTH = 2
const WORKFLOW_PATH = '.github/workflows/package-release.yml'
const EXPECTED_NODE_VERSIONS = ['22.19.0', '24'] as const
const EXPECTED_RELEASE_QA_NEEDS = ['release-plan'] as const
const INSTALL_CONSUMER_TOOLS_COMMAND =
  'node .release-tooling/scripts/package-consumer-tools.ts install --tool-root "$RUNNER_TEMP/package-managers" --github-path "$GITHUB_PATH"'
const VERIFY_CONSUMER_TOOLS_COMMAND =
  'node .release-tooling/scripts/package-consumer-tools.ts verify --tool-root "$RUNNER_TEMP/package-managers"'
const EXPECTED_RUN_COMMANDS = [
  'pnpm install --frozen-lockfile',
  INSTALL_CONSUMER_TOOLS_COMMAND,
  VERIFY_CONSUMER_TOOLS_COMMAND,
  'pnpm check',
  'pnpm exec playwright install chromium',
  'pnpm build:packages && pnpm package:smoke',
] as const
const EXPECTED_YARN_LOCKFILE_FREE_ENV = {
  YARN_ENABLE_IMMUTABLE_INSTALLS: 'false',
} as const
const EXPECTED_SMOKE_ENV = {
  OPENWAGGLE_PACKAGE_BROWSER_SMOKE: '1',
  OPENWAGGLE_PACKAGE_SMOKE_REQUIRED_MANAGERS: 'npm,pnpm,yarn,bun',
  ...EXPECTED_YARN_LOCKFILE_FREE_ENV,
} as const
const EXPECTED_RELEASE_QA_STEPS = [
  {
    uses: 'actions/checkout@df4cb1c069e1874edd31b4311f1884172cec0e10',
    with: { ref: '${{ needs.release-plan.outputs.source_sha }}' },
  },
  {
    name: 'Checkout immutable package consumer tooling',
    uses: 'actions/checkout@df4cb1c069e1874edd31b4311f1884172cec0e10',
    with: {
      ref: '${{ github.workflow_sha }}',
      path: '.release-tooling',
      'sparse-checkout': 'scripts/package-consumer-tools.ts',
      'sparse-checkout-cone-mode': false,
    },
  },
  {
    uses: 'pnpm/action-setup@b906affcce14559ad1aafd4ab0e942779e9f58b1',
    with: { version: '11.6.0' },
  },
  {
    uses: 'actions/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e',
    with: { 'node-version': '${{ matrix.node }}', cache: 'pnpm' },
  },
  {
    uses: 'oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6',
    with: { 'bun-version': '1.3.14' },
  },
  { run: 'pnpm install --frozen-lockfile' },
  { name: 'Install pinned package manager consumers', run: INSTALL_CONSUMER_TOOLS_COMMAND },
  { name: 'Verify package manager consumer versions', run: VERIFY_CONSUMER_TOOLS_COMMAND },
  {
    name: 'Run full release checks on Node 24',
    if: '${{ matrix.node == 24 }}',
    env: EXPECTED_YARN_LOCKFILE_FREE_ENV,
    run: 'pnpm check',
  },
  {
    name: 'Install Chromium for package browser smoke',
    run: 'pnpm exec playwright install chromium',
  },
  {
    name: 'Smoke packed consumers',
    env: EXPECTED_SMOKE_ENV,
    run: 'pnpm build:packages && pnpm package:smoke',
  },
] as const satisfies readonly WorkflowStepContract[]

function addViolation(condition: boolean, message: string, violations: string[]) {
  if (condition) violations.push(message)
}

function workflowJobBlock(workflowText: string, jobName: string) {
  const marker = `  ${jobName}:\n`
  const start = workflowText.indexOf(marker)
  if (start === -1) return ''
  const remainder = workflowText.slice(start + marker.length)
  const nextJob = remainder.search(
    new RegExp(`^ {${JOB_INDENT_WIDTH}}[a-zA-Z0-9_-]+:\\s*$`, 'm'),
  )
  return nextJob === -1 ? remainder : remainder.slice(0, nextJob)
}

function validateReleaseQaJobContract(workflowRoot: unknown, violations: string[]) {
  const matrixNodes = workflowJobMatrixValues(workflowRoot, 'release-qa', 'node')
  const jobNeeds = workflowJobNeeds(workflowRoot, 'release-qa')
  addViolation(
    workflowHasKey(workflowRoot, 'env') || workflowHasKey(workflowRoot, 'defaults'),
    `${WORKFLOW_PATH} must omit workflow-level environment and defaults from package publishing.`,
    violations,
  )
  addViolation(
    matrixNodes.length !== EXPECTED_NODE_VERSIONS.length ||
      matrixNodes.some((version, index) => version !== EXPECTED_NODE_VERSIONS[index]),
    `${WORKFLOW_PATH} release-qa must smoke consumers on Node 22.19.0 and Node 24.`,
    violations,
  )
  addViolation(
    !workflowJobHasOnlyKeys(workflowRoot, 'release-qa', [
      'name',
      'needs',
      'if',
      'runs-on',
      'strategy',
      'steps',
    ]) ||
      workflowJobCondition(workflowRoot, 'release-qa') !==
        "${{ always() && needs.release-plan.result == 'success' }}" ||
      jobNeeds.length !== EXPECTED_RELEASE_QA_NEEDS.length ||
      jobNeeds.some((need, index) => need !== EXPECTED_RELEASE_QA_NEEDS[index]) ||
      workflowJobRunsOn(workflowRoot, 'release-qa') !== 'ubuntu-latest' ||
      workflowJobFailFast(workflowRoot, 'release-qa') !== false ||
      !workflowJobStrategyHasOnlyKeys(workflowRoot, 'release-qa', ['fail-fast', 'matrix']) ||
      !workflowJobMatrixHasOnlyKeys(workflowRoot, 'release-qa', ['node']),
    `${WORKFLOW_PATH} release-qa must keep its exact blocking QA job contract.`,
    violations,
  )
}

function validateConsumerToolingSteps(workflowRoot: unknown, violations: string[]) {
  addViolation(
    !workflowJobHasExactSteps(workflowRoot, 'release-qa', EXPECTED_RELEASE_QA_STEPS),
    `${WORKFLOW_PATH} release-qa must execute exactly its approved source checkout, immutable tooling setup, and QA steps in order.`,
    violations,
  )
  const installIndex = jobExactNamedRunStepIndex(
    workflowRoot,
    'release-qa',
    'Install pinned package manager consumers',
    INSTALL_CONSUMER_TOOLS_COMMAND,
  )
  const verifyIndex = jobExactNamedRunStepIndex(
    workflowRoot,
    'release-qa',
    'Verify package manager consumer versions',
    VERIFY_CONSUMER_TOOLS_COMMAND,
  )
  addViolation(
    installIndex < 0,
    `${WORKFLOW_PATH} release-qa must install npm and Yarn in an isolated runner path.`,
    violations,
  )
  addViolation(
    verifyIndex < 0,
    `${WORKFLOW_PATH} release-qa must verify isolated npm and Yarn executable paths.`,
    violations,
  )
  const runCommands = workflowJobRunCommands(workflowRoot, 'release-qa')
  addViolation(
    runCommands.length !== EXPECTED_RUN_COMMANDS.length ||
      runCommands.some((command, index) => command !== EXPECTED_RUN_COMMANDS[index]),
    `${WORKFLOW_PATH} release-qa must install package consumer tools only through the typed integrity-pinned installer.`,
    violations,
  )
  const checkoutIndex = jobExactNamedActionStepWithInputsIndex(
    workflowRoot,
    'release-qa',
    'Checkout immutable package consumer tooling',
    'actions/checkout@df4cb1c069e1874edd31b4311f1884172cec0e10',
    {
      ref: '${{ github.workflow_sha }}',
      path: '.release-tooling',
      'sparse-checkout': 'scripts/package-consumer-tools.ts',
      'sparse-checkout-cone-mode': false,
    },
  )
  addViolation(
    checkoutIndex < 0,
    `${WORKFLOW_PATH} release-qa must checkout immutable package consumer tooling from the workflow commit.`,
    violations,
  )
  addViolation(
    checkoutIndex < 0 || installIndex <= checkoutIndex || verifyIndex <= installIndex,
    `${WORKFLOW_PATH} release-qa must checkout tooling before installing and verifying package consumers.`,
    violations,
  )
}

export function validateWorkflowConsumerSmoke(
  workflowRoot: unknown,
  workflowText: string,
  violations: string[],
) {
  const job = workflowJobBlock(workflowText, 'release-qa')
  validateReleaseQaJobContract(workflowRoot, violations)
  validateConsumerToolingSteps(workflowRoot, violations)
  addViolation(
    !runsExactCommand(job, 'pnpm build:packages && pnpm package:smoke'),
    `${WORKFLOW_PATH} release-qa must smoke exact packed consumers on every Node matrix entry.`,
    violations,
  )
  addViolation(
    !job.includes('version: 11.6.0'),
    `${WORKFLOW_PATH} release-qa must pin pnpm 11.6.0.`,
    violations,
  )
  addViolation(
    !job.includes('bun-version: 1.3.14'),
    `${WORKFLOW_PATH} release-qa must install Bun 1.3.14.`,
    violations,
  )
  const browserInstall = jobHasDedicatedExactRunStep(
    workflowRoot,
    'release-qa',
    'pnpm exec playwright install chromium',
  )
  addViolation(
    !browserInstall,
    `${WORKFLOW_PATH} release-qa must install Chromium with pinned project Playwright tooling.`,
    violations,
  )
  const fullReleaseChecks = jobHasConditionalExactRunStepWithEnv(
    workflowRoot,
    'release-qa',
    'pnpm check',
    '${{ matrix.node == 24 }}',
    EXPECTED_YARN_LOCKFILE_FREE_ENV,
  )
  addViolation(
    !fullReleaseChecks,
    `${WORKFLOW_PATH} release-qa full checks must disable Yarn immutable installs for lockfile-free packed consumers.`,
    violations,
  )
  const browserSmoke = jobHasDedicatedExactRunStepWithEnv(
    workflowRoot,
    'release-qa',
    'pnpm build:packages && pnpm package:smoke',
    EXPECTED_SMOKE_ENV,
  )
  addViolation(
    !browserSmoke,
    `${WORKFLOW_PATH} release-qa must run browser-enabled package smoke on every Node matrix entry.`,
    violations,
  )
  addViolation(
    !browserSmoke,
    `${WORKFLOW_PATH} release-qa must disable Yarn immutable installs for lockfile-free packed consumers.`,
    violations,
  )
  addViolation(
    !job.includes("OPENWAGGLE_PACKAGE_SMOKE_REQUIRED_MANAGERS: 'npm,pnpm,yarn,bun'"),
    `${WORKFLOW_PATH} release-qa must require npm, pnpm, Yarn, and Bun package consumers.`,
    violations,
  )
}
