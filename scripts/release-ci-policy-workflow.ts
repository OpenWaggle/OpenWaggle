import { isMap, isScalar, parseDocument } from 'yaml'

export interface ReleaseCiWorkflowJob {
  readonly block: string
  readonly keys: readonly string[]
  readonly name: string
}

function mapValue(node: unknown, key: string) {
  if (!isMap(node)) return undefined
  for (const pair of node.items) {
    if (isScalar(pair.key) && pair.key.value === key) return pair.value
  }
  return undefined
}

function scalarString(node: unknown): string | undefined {
  return isScalar(node) && typeof node.value === 'string' ? node.value : undefined
}

function mapKeys(node: unknown) {
  if (!isMap(node)) return []
  return node.items.flatMap((pair) => {
    const key = scalarString(pair.key)
    return key === undefined ? [] : [key]
  })
}

function readTextJobBlocks(workflow: string) {
  const jobsMarker = 'jobs:\n'
  const jobsStart = workflow.indexOf(jobsMarker)
  if (jobsStart === -1) return new Map<string, string>()

  const jobsSection = workflow.slice(jobsStart + jobsMarker.length)
  const jobStarts = [...jobsSection.matchAll(/^ {2}([A-Za-z0-9_-]+):\s*$/gm)].flatMap(
    (match) =>
      match.index === undefined || match[1] === undefined
        ? []
        : [{ id: match[1], index: match.index }],
  )

  return new Map(
    jobStarts.map(({ id, index: start }, position) => [
      id,
      jobsSection.slice(start, jobStarts[position + 1]?.index ?? jobsSection.length).trimEnd(),
    ]),
  )
}

export function readReleaseCiWorkflowJobs(workflow: string) {
  const document = parseDocument(workflow)
  if (document.errors.length > 0) return []
  const jobs = mapValue(document.contents, 'jobs')
  if (!isMap(jobs)) return []
  const textBlocks = readTextJobBlocks(workflow)

  return jobs.items.flatMap((pair) => {
    const id = scalarString(pair.key)
    if (id === undefined) return []
    return [
      {
        block: textBlocks.get(id) ?? '',
        keys: mapKeys(pair.value),
        name: scalarString(mapValue(pair.value, 'name')) ?? '',
      } satisfies ReleaseCiWorkflowJob,
    ]
  })
}
