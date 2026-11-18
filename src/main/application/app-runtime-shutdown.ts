export async function completeAppRuntimeShutdown(input: {
  readonly persistActiveRuns: () => Promise<void>
  readonly disposeRuntime: () => Promise<void>
}) {
  try {
    await input.persistActiveRuns()
  } finally {
    await input.disposeRuntime()
  }
}
