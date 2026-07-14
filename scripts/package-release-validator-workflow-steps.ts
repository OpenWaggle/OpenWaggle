import { isMap, isScalar, isSeq } from 'yaml'

function mapValue(node: unknown, key: string) {
  if (!isMap(node)) return undefined
  for (const pair of node.items) {
    if (isScalar(pair.key) && pair.key.value === key) return pair.value
  }
  return undefined
}

function workflowJobSteps(workflowRoot: unknown, jobName: string) {
  const steps = mapValue(mapValue(mapValue(workflowRoot, 'jobs'), jobName), 'steps')
  return isSeq(steps) ? steps.items : []
}

function scalarString(node: unknown): string | undefined {
  return isScalar(node) && typeof node.value === 'string' ? node.value : undefined
}

export function workflowJobCondition(
  workflowRoot: unknown,
  jobName: string,
): string | undefined {
  return scalarString(mapValue(mapValue(mapValue(workflowRoot, 'jobs'), jobName), 'if'))
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

function isDedicatedExactRunStep(step: unknown, command: string) {
  const run = mapValue(step, 'run')
  return (
    isScalar(run) &&
    run.value === command &&
    !['continue-on-error', 'shell', 'if'].some((key) => mapValue(step, key) !== undefined)
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

export function jobHasDedicatedExactRunStepWithEnv(
  workflowRoot: unknown,
  jobName: string,
  command: string,
  envName: string,
  envValue: string,
) {
  return workflowJobSteps(workflowRoot, jobName).some((step) => {
    const actualEnvValue = mapValue(mapValue(step, 'env'), envName)
    return (
      isDedicatedExactRunStep(step, command) &&
      isScalar(actualEnvValue) &&
      actualEnvValue.value === envValue
    )
  })
}
