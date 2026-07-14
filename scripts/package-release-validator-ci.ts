import { parsePackageReleaseWorkflow } from './package-release-validator-workflow-structure'
import {
  jobExactNamedActionStepWithInputsIndex,
  jobExactNamedRunStepIndex,
  workflowJobFailFast,
  workflowJobHasOnlyKeys,
  workflowJobHasExactSteps,
  workflowJobMatrixHasOnlyKeys,
  workflowJobMatrixValues,
  workflowJobRunsOn,
  workflowJobRunCommands,
  workflowJobStrategyHasOnlyKeys,
  workflowHasKey,
  workflowMappingHasExactValues,
} from './package-release-validator-workflow-steps'
import type { WorkflowStepContract } from './package-release-validator-workflow-steps'

const CI_WORKFLOW_PATH = '.github/workflows/ci.yml'
const EXPECTED_NODE_VERSIONS = ['22.19.0', '24'] as const
const INSTALL_CONSUMER_TOOLS_COMMAND =
  'node scripts/package-consumer-tools.ts install --tool-root "$RUNNER_TEMP/package-managers" --github-path "$GITHUB_PATH"'
const VERIFY_CONSUMER_TOOLS_COMMAND =
  'node scripts/package-consumer-tools.ts verify --tool-root "$RUNNER_TEMP/package-managers"'
const EXPECTED_RUN_COMMANDS = [
  INSTALL_CONSUMER_TOOLS_COMMAND,
  VERIFY_CONSUMER_TOOLS_COMMAND,
] as const
const EXPECTED_CONSUMER_TOOL_STEPS = [
  {
    name: 'Checkout exact CI revision',
    uses: 'actions/checkout@df4cb1c069e1874edd31b4311f1884172cec0e10',
    with: {
      ref: "${{ github.event_name == 'workflow_dispatch' && inputs.head_sha || github.sha }}",
    },
  },
  {
    name: 'Set up pinned pnpm',
    uses: 'pnpm/action-setup@b906affcce14559ad1aafd4ab0e942779e9f58b1',
    with: { version: '11.6.0' },
  },
  {
    name: 'Set up matrix Node',
    uses: 'actions/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e',
    with: { 'node-version': '${{ matrix.node }}' },
  },
  {
    name: 'Set up pinned Bun',
    uses: 'oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6',
    with: { 'bun-version': '1.3.14' },
  },
  {
    name: 'Install pinned package manager consumers',
    run: INSTALL_CONSUMER_TOOLS_COMMAND,
  },
  {
    name: 'Verify package manager consumer versions',
    run: VERIFY_CONSUMER_TOOLS_COMMAND,
  },
] as const satisfies readonly WorkflowStepContract[]

function addViolation(condition: boolean, message: string, violations: string[]) {
  if (condition) violations.push(message)
}

function requireText(
  source: string,
  requirements: readonly (readonly [string, string])[],
  violations: string[],
) {
  for (const [snippet, message] of requirements) {
    addViolation(!source.includes(snippet), message, violations)
  }
}

function validateWorkflowExecutionContext(workflowRoot: unknown, violations: string[]) {
  addViolation(
    !workflowMappingHasExactValues(workflowRoot, 'env', {
      FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: true,
    }) || workflowHasKey(workflowRoot, 'defaults'),
    `${CI_WORKFLOW_PATH} must keep its exact workflow-level execution environment and omit workflow defaults.`,
    violations,
  )
}

export function validateCiWorkflowText(ciWorkflowText: string, violations: string[]) {
  const workflow = parsePackageReleaseWorkflow(ciWorkflowText)
  for (const error of workflow.errors) {
    violations.push(`${CI_WORKFLOW_PATH} must contain valid YAML: ${error}`)
  }
  validateWorkflowExecutionContext(workflow.root, violations)
  requireText(
    ciWorkflowText,
    [
      ['workflow_dispatch:', `${CI_WORKFLOW_PATH} must accept release PR CI dispatches.`],
      [
        'head_sha:',
        `${CI_WORKFLOW_PATH} must accept the exact release PR head SHA as input head_sha.`,
      ],
      ['DISPATCHED_SHA: ${{ github.sha }}', `${CI_WORKFLOW_PATH} must read the dispatched SHA.`],
      [
        'EXPECTED_SHA: ${{ inputs.head_sha }}',
        `${CI_WORKFLOW_PATH} must read the expected release PR SHA.`,
      ],
      [
        'test "$DISPATCHED_SHA" = "$EXPECTED_SHA"',
        `${CI_WORKFLOW_PATH} must fail closed when the dispatched branch moved from the release PR SHA.`,
      ],
    ],
    violations,
  )
  const matrixNodes = workflowJobMatrixValues(workflow.root, 'package-consumer-tools', 'node')
  addViolation(
    matrixNodes.length !== EXPECTED_NODE_VERSIONS.length ||
      matrixNodes.some((version, index) => version !== EXPECTED_NODE_VERSIONS[index]),
    `${CI_WORKFLOW_PATH} package-consumer-tools must test exactly Node 22.19.0 and Node 24.`,
    violations,
  )
  addViolation(
    !workflowJobHasOnlyKeys(workflow.root, 'package-consumer-tools', [
      'name',
      'runs-on',
      'strategy',
      'steps',
    ]) ||
      workflowJobRunsOn(workflow.root, 'package-consumer-tools') !== 'ubuntu-latest' ||
      workflowJobFailFast(workflow.root, 'package-consumer-tools') !== false ||
      !workflowJobStrategyHasOnlyKeys(workflow.root, 'package-consumer-tools', [
        'fail-fast',
        'matrix',
      ]) ||
      !workflowJobMatrixHasOnlyKeys(workflow.root, 'package-consumer-tools', ['node']),
    `${CI_WORKFLOW_PATH} package-consumer-tools must keep its exact blocking job contract.`,
    violations,
  )
  addViolation(
    !workflowJobHasExactSteps(
      workflow.root,
      'package-consumer-tools',
      EXPECTED_CONSUMER_TOOL_STEPS,
    ),
    `${CI_WORKFLOW_PATH} package-consumer-tools must contain exactly its approved pinned setup, install, and verification steps in order.`,
    violations,
  )
  const stepIndexes = [
    jobExactNamedActionStepWithInputsIndex(
      workflow.root,
      'package-consumer-tools',
      'Checkout exact CI revision',
      'actions/checkout@df4cb1c069e1874edd31b4311f1884172cec0e10',
      { ref: "${{ github.event_name == 'workflow_dispatch' && inputs.head_sha || github.sha }}" },
    ),
    jobExactNamedActionStepWithInputsIndex(
      workflow.root,
      'package-consumer-tools',
      'Set up pinned pnpm',
      'pnpm/action-setup@b906affcce14559ad1aafd4ab0e942779e9f58b1',
      { version: '11.6.0' },
    ),
    jobExactNamedActionStepWithInputsIndex(
      workflow.root,
      'package-consumer-tools',
      'Set up matrix Node',
      'actions/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e',
      { 'node-version': '${{ matrix.node }}' },
    ),
    jobExactNamedActionStepWithInputsIndex(
      workflow.root,
      'package-consumer-tools',
      'Set up pinned Bun',
      'oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6',
      { 'bun-version': '1.3.14' },
    ),
    jobExactNamedRunStepIndex(
      workflow.root,
      'package-consumer-tools',
      'Install pinned package manager consumers',
      'node scripts/package-consumer-tools.ts install --tool-root "$RUNNER_TEMP/package-managers" --github-path "$GITHUB_PATH"',
    ),
    jobExactNamedRunStepIndex(
      workflow.root,
      'package-consumer-tools',
      'Verify package manager consumer versions',
      'node scripts/package-consumer-tools.ts verify --tool-root "$RUNNER_TEMP/package-managers"',
    ),
  ]
  addViolation(
    stepIndexes.some((index) => index < 0) ||
      stepIndexes.some(
        (index, position) =>
          position > 0 && index <= (stepIndexes[position - 1] ?? Number.NEGATIVE_INFINITY),
      ),
    `${CI_WORKFLOW_PATH} package-consumer-tools must execute its exact pinned setup, install, and verification steps in order.`,
    violations,
  )
  const runCommands = workflowJobRunCommands(workflow.root, 'package-consumer-tools')
  addViolation(
    runCommands.length !== EXPECTED_RUN_COMMANDS.length ||
      runCommands.some((command, index) => command !== EXPECTED_RUN_COMMANDS[index]),
    `${CI_WORKFLOW_PATH} package-consumer-tools must execute only its exact typed install and verification commands.`,
    violations,
  )
}
