import { isMap, isScalar, isSeq } from 'yaml'

const EXACT_NAMED_ACTION_STEP_KEY_COUNT = 3

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

function workflowJobSteps(workflowRoot: unknown, jobName: string) {
  const steps = mapValue(mapValue(mapValue(workflowRoot, 'jobs'), jobName), 'steps')
  return isSeq(steps) ? steps.items : []
}

function scalarString(node: unknown): string | undefined {
  return isScalar(node) && typeof node.value === 'string' ? node.value : undefined
}

type WorkflowStepScalar = string | number | boolean

export type WorkflowStepContract = Readonly<
  Record<string, WorkflowStepScalar | Readonly<Record<string, WorkflowStepScalar>>>
>

function scalarValue(node: unknown): WorkflowStepScalar | undefined {
  return isScalar(node) &&
    (typeof node.value === 'string' ||
      typeof node.value === 'number' ||
      typeof node.value === 'boolean')
    ? node.value
    : undefined
}

function hasOnlyKeys(node: unknown, allowedKeys: readonly string[]) {
  const actualKeys = mapKeys(node)
  return actualKeys.length === allowedKeys.length && actualKeys.every((key) => allowedKeys.includes(key))
}

function matchesExactMapping(node: unknown, expected: WorkflowStepContract): boolean {
  const expectedKeys = Object.keys(expected)
  if (!hasOnlyKeys(node, expectedKeys)) return false
  return expectedKeys.every((key) => {
    const expectedValue = expected[key]
    const actualValue = mapValue(node, key)
    return typeof expectedValue === 'object'
      ? matchesExactMapping(actualValue, expectedValue)
      : scalarValue(actualValue) === expectedValue
  })
}

export function workflowJobCondition(
  workflowRoot: unknown,
  jobName: string,
): string | undefined {
  return scalarString(mapValue(mapValue(mapValue(workflowRoot, 'jobs'), jobName), 'if'))
}

export function workflowHasKey(workflowRoot: unknown, key: string) {
  return mapKeys(workflowRoot).includes(key)
}

export function workflowMappingHasExactValues(
  workflowRoot: unknown,
  mappingName: string,
  expected: WorkflowStepContract,
) {
  return matchesExactMapping(mapValue(workflowRoot, mappingName), expected)
}

export function workflowJobNeeds(workflowRoot: unknown, jobName: string): readonly string[] {
  const needs = mapValue(mapValue(mapValue(workflowRoot, 'jobs'), jobName), 'needs')
  if (isScalar(needs) && typeof needs.value === 'string') return [needs.value]
  if (!isSeq(needs)) return []
  return needs.items.flatMap((item) => {
    const name = scalarString(item)
    return name === undefined ? [] : [name]
  })
}

export function workflowJobRunCommands(
  workflowRoot: unknown,
  jobName: string,
): readonly string[] {
  return workflowJobSteps(workflowRoot, jobName).flatMap((step) => {
    const command = scalarString(mapValue(step, 'run'))
    return command === undefined ? [] : [command]
  })
}

export function workflowJobHasExactSteps(
  workflowRoot: unknown,
  jobName: string,
  expectedSteps: readonly WorkflowStepContract[],
) {
  const actualSteps = workflowJobSteps(workflowRoot, jobName)
  return (
    actualSteps.length === expectedSteps.length &&
    actualSteps.every((step, index) => matchesExactMapping(step, expectedSteps[index] ?? {}))
  )
}

export function workflowJobMatrixValues(
  workflowRoot: unknown,
  jobName: string,
  matrixName: string,
): readonly string[] {
  const matrix = mapValue(
    mapValue(mapValue(mapValue(workflowRoot, 'jobs'), jobName), 'strategy'),
    'matrix',
  )
  const values = mapValue(matrix, matrixName)
  if (!isSeq(values)) return []
  return values.items.flatMap((item) => {
    if (!isScalar(item)) return []
    return typeof item.value === 'string' || typeof item.value === 'number'
      ? [String(item.value)]
      : []
  })
}

export function workflowJobRunsOn(workflowRoot: unknown, jobName: string) {
  return scalarString(mapValue(mapValue(mapValue(workflowRoot, 'jobs'), jobName), 'runs-on'))
}

export function workflowJobFailFast(workflowRoot: unknown, jobName: string) {
  const failFast = mapValue(
    mapValue(mapValue(mapValue(workflowRoot, 'jobs'), jobName), 'strategy'),
    'fail-fast',
  )
  return isScalar(failFast) && typeof failFast.value === 'boolean' ? failFast.value : undefined
}

export function workflowJobHasOnlyKeys(
  workflowRoot: unknown,
  jobName: string,
  expectedKeys: readonly string[],
) {
  return hasOnlyKeys(mapValue(mapValue(workflowRoot, 'jobs'), jobName), expectedKeys)
}

export function workflowJobStrategyHasOnlyKeys(
  workflowRoot: unknown,
  jobName: string,
  expectedKeys: readonly string[],
) {
  const strategy = mapValue(mapValue(mapValue(workflowRoot, 'jobs'), jobName), 'strategy')
  return hasOnlyKeys(strategy, expectedKeys)
}

export function workflowJobMatrixHasOnlyKeys(
  workflowRoot: unknown,
  jobName: string,
  expectedKeys: readonly string[],
) {
  const matrix = mapValue(
    mapValue(mapValue(mapValue(workflowRoot, 'jobs'), jobName), 'strategy'),
    'matrix',
  )
  return hasOnlyKeys(matrix, expectedKeys)
}

function hasExactRunCommand(step: unknown, command: string) {
  const run = mapValue(step, 'run')
  return isScalar(run) && run.value === command
}

function isDedicatedExactRunStep(step: unknown, command: string) {
  return (
    hasExactRunCommand(step, command) &&
    mapKeys(step).every((key) => key === 'name' || key === 'run')
  )
}

export function jobHasDedicatedExactRunStep(
  workflowRoot: unknown,
  jobName: string,
  command: string,
) {
  return workflowJobSteps(workflowRoot, jobName).some((step) =>
    isDedicatedExactRunStep(step, command),
  )
}

export function jobHasDedicatedExactNamedRunStep(
  workflowRoot: unknown,
  jobName: string,
  stepName: string,
  command: string,
) {
  return jobExactNamedRunStepIndex(workflowRoot, jobName, stepName, command) >= 0
}

export function jobExactNamedRunStepIndex(
  workflowRoot: unknown,
  jobName: string,
  stepName: string,
  command: string,
) {
  return workflowJobSteps(workflowRoot, jobName).findIndex(
    (step) =>
      scalarString(mapValue(step, 'name')) === stepName &&
      hasExactRunCommand(step, command) &&
      hasOnlyKeys(step, ['name', 'run']),
  )
}

export function jobHasExactNamedActionStepWithInputs(
  workflowRoot: unknown,
  jobName: string,
  stepName: string,
  action: string,
  expectedInputs: Readonly<Record<string, string | boolean>>,
) {
  return jobExactNamedActionStepWithInputsIndex(
    workflowRoot,
    jobName,
    stepName,
    action,
    expectedInputs,
  ) >= 0
}

export function jobExactNamedActionStepWithInputsIndex(
  workflowRoot: unknown,
  jobName: string,
  stepName: string,
  action: string,
  expectedInputs: Readonly<Record<string, string | boolean>>,
) {
  return workflowJobSteps(workflowRoot, jobName).findIndex((step) => {
    const inputs = mapValue(step, 'with')
    const expectedInputKeys = Object.keys(expectedInputs)
    return (
      scalarString(mapValue(step, 'name')) === stepName &&
      scalarString(mapValue(step, 'uses')) === action &&
      mapKeys(step).length === EXACT_NAMED_ACTION_STEP_KEY_COUNT &&
      mapKeys(inputs).length === expectedInputKeys.length &&
      expectedInputKeys.every((key) => scalarValue(mapValue(inputs, key)) === expectedInputs[key])
    )
  })
}

export function jobHasDedicatedExactRunStepWithEnv(
  workflowRoot: unknown,
  jobName: string,
  command: string,
  expectedEnv: Readonly<Record<string, WorkflowStepScalar>>,
) {
  return workflowJobSteps(workflowRoot, jobName).some((step) => {
    return (
      hasExactRunCommand(step, command) &&
      hasOnlyKeys(step, ['name', 'env', 'run']) &&
      matchesExactMapping(mapValue(step, 'env'), expectedEnv)
    )
  })
}

export function jobHasConditionalExactRunStepWithEnv(
  workflowRoot: unknown,
  jobName: string,
  command: string,
  condition: string,
  expectedEnv: Readonly<Record<string, WorkflowStepScalar>>,
) {
  return workflowJobSteps(workflowRoot, jobName).some((step) => {
    return (
      hasExactRunCommand(step, command) &&
      scalarString(mapValue(step, 'if')) === condition &&
      hasOnlyKeys(step, ['name', 'if', 'env', 'run']) &&
      matchesExactMapping(mapValue(step, 'env'), expectedEnv)
    )
  })
}
