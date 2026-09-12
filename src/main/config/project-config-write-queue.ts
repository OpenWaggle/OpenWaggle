const projectWriteQueues = new Map<string, Promise<unknown>>()

/** Serializes each project's read-modify-write settings transaction. */
export function enqueueProjectConfigWrite<T>(
  configPath: string,
  operation: () => Promise<T>,
): Promise<T> {
  const previous = projectWriteQueues.get(configPath) ?? Promise.resolve()
  const result = previous.then(operation, operation)
  const tail = result.catch(() => undefined)
  projectWriteQueues.set(configPath, tail)
  void tail.then(() => {
    if (projectWriteQueues.get(configPath) === tail) projectWriteQueues.delete(configPath)
  })
  return result
}

/** Test-only visibility into retained serialization state; not re-exported by config APIs. */
export function projectConfigWriteQueueCountForTests() {
  return projectWriteQueues.size
}

/** Test-only isolation for direct queue tests. */
export function resetProjectConfigWriteQueuesForTests() {
  projectWriteQueues.clear()
}
