import { createHash } from 'node:crypto'
import { isAlias, isMap, isScalar, isSeq, parseDocument } from 'yaml'

const EMPTY_COUNT = 0
const EXACT_NODE_SETUP_INPUT_KEY_COUNT = 2
const EXACT_NODE_SETUP_STEP_KEY_COUNT = 3
const EXACT_NPM_VERSION_STEP_KEY_COUNT = 3
const EXACT_PUBLICATION_STEP_KEY_COUNT = 4

export interface WorkflowActionUse {
  readonly ref?: string
  readonly versionComment?: string
}

export function parsePackageReleaseWorkflow(workflowText: string) {
  const document = parseDocument(workflowText, {
    prettyErrors: false,
    strict: true,
    uniqueKeys: true,
  })
  return {
    errors: document.errors.map((error) => error.message),
    root: document.contents,
  }
}

function stripYamlComment(line: string) {
  let inSingleQuote = false
  let inDoubleQuote = false
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index]
    if (character === "'" && !inDoubleQuote) inSingleQuote = !inSingleQuote
    if (character === '"' && !inSingleQuote && line[index - 1] !== '\\') {
      inDoubleQuote = !inDoubleQuote
    }
    if (character === '#' && !inSingleQuote && !inDoubleQuote) {
      return line.slice(0, index).trimEnd()
    }
  }
  return line
}

export function executableWorkflowText(workflowText: string) {
  return workflowText
    .split('\n')
    .map(stripYamlComment)
    .filter((line) => line.trim().length > EMPTY_COUNT)
    .join('\n')
}

function collectWorkflowRunCommands(node: unknown, commands: string[]) {
  if (isMap(node)) {
    for (const pair of node.items) {
      if (
        isScalar(pair.key) &&
        pair.key.value === 'run' &&
        isScalar(pair.value) &&
        typeof pair.value.value === 'string'
      ) {
        commands.push(pair.value.value)
      }
      collectWorkflowRunCommands(pair.value, commands)
    }
    return
  }
  if (isSeq(node)) {
    for (const item of node.items) collectWorkflowRunCommands(item, commands)
  }
}

export function workflowRunCommands(workflowText: string) {
  const commands: string[] = []
  collectWorkflowRunCommands(parsePackageReleaseWorkflow(workflowText).root, commands)
  return commands
}

export function executableShellLines(command: string) {
  return command
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > EMPTY_COUNT && !line.startsWith('#'))
}

export function runsExactCommand(workflowText: string, expectedCommand: string) {
  return workflowRunCommands(workflowText).some((command) =>
    executableShellLines(command).includes(expectedCommand),
  )
}

export function runsCommandFragment(workflowText: string, expectedFragment: string) {
  return workflowRunCommands(workflowText).some((command) =>
    executableShellLines(command).some(
      (line) =>
        !/^(?:echo|printf|true|:)(?:\s|$)/.test(line) && line.includes(expectedFragment),
    ),
  )
}

function collectWorkflowActionUses(node: unknown, uses: WorkflowActionUse[]) {
  if (isMap(node)) {
    for (const pair of node.items) {
      if (isScalar(pair.key) && pair.key.value === 'uses') {
        const value = pair.value
        if (isScalar(value) && typeof value.value === 'string') {
          const versionComment = value.comment?.trim()
          uses.push(versionComment ? { ref: value.value, versionComment } : { ref: value.value })
        } else {
          uses.push({})
        }
      }
      collectWorkflowActionUses(pair.value, uses)
    }
    return
  }
  if (isSeq(node)) {
    for (const item of node.items) collectWorkflowActionUses(item, uses)
  }
}

export function workflowActionUses(workflowRoot: unknown) {
  const uses: WorkflowActionUse[] = []
  collectWorkflowActionUses(workflowRoot, uses)
  return uses
}

function mapValue(node: unknown, key: string) {
  if (!isMap(node)) return undefined
  for (const pair of node.items) {
    if (isScalar(pair.key) && pair.key.value === key) return pair.value
  }
  return undefined
}

function mapKeys(node: unknown) {
  if (!isMap(node)) return []
  return node.items.flatMap((pair) =>
    isScalar(pair.key) && typeof pair.key.value === 'string' ? [pair.key.value] : [],
  )
}

function scalarString(node: unknown) {
  return isScalar(node) && typeof node.value === 'string' ? node.value : undefined
}

function workflowJobs(workflowRoot: unknown) {
  const jobs = mapValue(workflowRoot, 'jobs')
  if (!isMap(jobs)) return []
  return jobs.items.flatMap((pair) => {
    const name = scalarString(pair.key)
    return name ? [{ name, node: pair.value }] : []
  })
}

function workflowJobSteps(workflowRoot: unknown, jobName: string) {
  const steps = mapValue(mapValue(mapValue(workflowRoot, 'jobs'), jobName), 'steps')
  return isSeq(steps) ? steps.items : []
}

const PUBLICATION_JOB_NAMES = ['publish-bases', 'publish-dependents'] as const
const PUBLICATION_JOB_NAME_SET = new Set<string>(PUBLICATION_JOB_NAMES)
const PUBLICATION_STEP_NAME = 'Publish exact validated tarball with npm Trusted Publishing'
const PUBLICATION_COMMAND = 'node scripts/package-release-publish.ts "$TARBALL"'
const RELEASED_CONDITION = "${{ matrix.released == 'true' }}"
const SETUP_NODE_ACTION = 'actions/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e'
const NPM_VERSION_STEP_NAME = 'Verify trusted-publishing npm version'
const NPM_VERSION_COMMAND = 'test "$(npm --version)" = "11.9.0"'
const PACKAGE_MANAGER_SETUP_ACTION = 'pnpm/action-setup@'
const INSTALL_COMMAND_PATTERN = /(?:^|\s)(?:npm|pnpm|yarn|bun)\s+(?:add|install)(?:\s|$)/

const PUBLICATION_JOB_HASHES = {
  'publish-bases': 'e0b23bd2bf7cc82f4450de40132ea50dfc96be6fa5fa4c124322544e2abe6814',
  'publish-dependents': 'e434cbd3c68d8fbcc79387897abdfbcd5cf09c175379b208341be7bed815f717',
} as const

function mapHash(node: unknown) {
  if (!isMap(node)) return undefined
  return createHash('sha256').update(JSON.stringify(node.toJSON())).digest('hex')
}

function hasExactStringMapping(node: unknown, expected: Readonly<Record<string, string>>) {
  const keys = mapKeys(node)
  const expectedKeys = Object.keys(expected)
  return (
    keys.length === expectedKeys.length &&
    expectedKeys.every((key) => scalarString(mapValue(node, key)) === expected[key])
  )
}

function isExactPublicationStep(step: unknown) {
  return (
    hasExactStringMapping(mapValue(step, 'env'), {
      TARBALL: '${{ steps.artifact.outputs.tarball }}',
    }) &&
    scalarString(mapValue(step, 'name')) === PUBLICATION_STEP_NAME &&
    scalarString(mapValue(step, 'if')) === RELEASED_CONDITION &&
    scalarString(mapValue(step, 'run')) === PUBLICATION_COMMAND &&
    mapKeys(step).length === EXACT_PUBLICATION_STEP_KEY_COUNT &&
    ['name', 'if', 'env', 'run'].every((key) => mapKeys(step).includes(key))
  )
}

function isExactPublicationNodeSetup(step: unknown) {
  const withInputs = mapValue(step, 'with')
  const packageManagerCache = mapValue(withInputs, 'package-manager-cache')
  return (
    scalarString(mapValue(step, 'uses')) === SETUP_NODE_ACTION && scalarString(mapValue(step, 'if')) === RELEASED_CONDITION &&
    scalarString(mapValue(withInputs, 'node-version')) === '24.14.0' &&
    isScalar(packageManagerCache) && packageManagerCache.value === false &&
    mapKeys(withInputs).length === EXACT_NODE_SETUP_INPUT_KEY_COUNT &&
    mapKeys(step).length === EXACT_NODE_SETUP_STEP_KEY_COUNT
  )
}

function isExactNpmVersionStep(step: unknown) {
  return (
    scalarString(mapValue(step, 'name')) === NPM_VERSION_STEP_NAME && scalarString(mapValue(step, 'if')) === RELEASED_CONDITION &&
    scalarString(mapValue(step, 'run')) === NPM_VERSION_COMMAND &&
    mapKeys(step).length === EXACT_NPM_VERSION_STEP_KEY_COUNT
  )
}

function hasExactPublicationRuntime(steps: readonly unknown[]) {
  const setupNodeIndex = steps.findIndex(isExactPublicationNodeSetup)
  const npmVersionIndex = steps.findIndex(isExactNpmVersionStep)
  const publicationIndex = steps.findIndex(isExactPublicationStep)
  return setupNodeIndex >= 0 && npmVersionIndex > setupNodeIndex && publicationIndex > npmVersionIndex
}

function hasUnauthorizedPublicationCapability(job: unknown) {
  const permissions = mapValue(job, 'permissions')
  return (
    mapValue(job, 'environment') !== undefined ||
    scalarString(permissions) === 'write-all' ||
    mapValue(permissions, 'id-token') !== undefined
  )
}

function containsYamlReference(node: unknown): boolean {
  if (isAlias(node)) return true
  if (isMap(node)) {
    return (
      Boolean(node.anchor) ||
      node.items.some(
        (pair) => containsYamlReference(pair.key) || containsYamlReference(pair.value),
      )
    )
  }
  if (isSeq(node)) {
    return Boolean(node.anchor) || node.items.some(containsYamlReference)
  }
  return isScalar(node) && Boolean(node.anchor)
}

function hasForbiddenPublicationInstall(steps: readonly unknown[]) {
  return steps.some((step) => {
    const uses = scalarString(mapValue(step, 'uses'))
    const run = scalarString(mapValue(step, 'run'))
    return (
      uses?.startsWith(PACKAGE_MANAGER_SETUP_ACTION) === true ||
      (run !== undefined && INSTALL_COMMAND_PATTERN.test(run))
    )
  })
}

export interface PublicationBoundaryValidation {
  readonly jobsWithInvalidCapability: readonly string[]
  readonly jobsWithInvalidContract: readonly string[]
  readonly jobsWithInvalidRuntime: readonly string[]
  readonly jobsWithInvalidPublisher: readonly string[]
  readonly jobsWithForbiddenInstall: readonly string[]
  readonly unauthorizedCapabilityJobs: readonly string[]
  readonly workflowControlsInvalid: boolean
  readonly workflowUsesYamlReferences: boolean
}

export function validatePublicationBoundary(workflowRoot: unknown): PublicationBoundaryValidation {
  const jobs = workflowJobs(workflowRoot)
  const unauthorizedCapabilityJobs = jobs
    .filter(
      ({ name, node }) =>
        !PUBLICATION_JOB_NAME_SET.has(name) &&
        hasUnauthorizedPublicationCapability(node),
    )
    .map(({ name }) => name)
  const jobsWithInvalidContract: string[] = []
  const jobsWithInvalidRuntime: string[] = []
  const jobsWithInvalidPublisher: string[] = []
  const jobsWithInvalidCapability: string[] = []
  const jobsWithForbiddenInstall: string[] = []
  const workflowControlsInvalid =
    mapValue(workflowRoot, 'env') !== undefined ||
    mapValue(workflowRoot, 'defaults') !== undefined ||
    !hasExactStringMapping(mapValue(workflowRoot, 'permissions'), { contents: 'read' })

  for (const jobName of PUBLICATION_JOB_NAMES) {
    const job = jobs.find(({ name }) => name === jobName)?.node
    const steps = workflowJobSteps(workflowRoot, jobName)
    if (mapHash(job) !== PUBLICATION_JOB_HASHES[jobName]) {
      jobsWithInvalidContract.push(jobName)
    }
    if (steps.filter(isExactPublicationStep).length !== 1) {
      jobsWithInvalidPublisher.push(jobName)
    }
    if (!hasExactPublicationRuntime(steps)) jobsWithInvalidRuntime.push(jobName)
    if (hasForbiddenPublicationInstall(steps)) {
      jobsWithForbiddenInstall.push(jobName)
    }
    if (
      scalarString(mapValue(job, 'environment')) !== 'npm' ||
      !hasExactStringMapping(mapValue(job, 'permissions'), { 'id-token': 'write' })
    ) {
      jobsWithInvalidCapability.push(jobName)
    }
  }

  return { jobsWithForbiddenInstall, jobsWithInvalidCapability, jobsWithInvalidContract,
    jobsWithInvalidRuntime,
    jobsWithInvalidPublisher, unauthorizedCapabilityJobs, workflowControlsInvalid,
    workflowUsesYamlReferences: containsYamlReference(workflowRoot) }
}
