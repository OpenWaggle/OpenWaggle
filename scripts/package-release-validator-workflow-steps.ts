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
