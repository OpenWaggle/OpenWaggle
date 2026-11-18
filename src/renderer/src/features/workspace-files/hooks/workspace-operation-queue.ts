interface WorkspaceOperationQueueContext {
  readonly inFlight: { current: Promise<void> | null }
}

export async function runWorkspaceQueueOperation(
  context: WorkspaceOperationQueueContext,
  action: () => Promise<void>,
) {
  const previous = context.inFlight.current
  const operation = (previous ? previous.catch(() => undefined) : Promise.resolve()).then(action)
  context.inFlight.current = operation
  try {
    await operation
  } finally {
    if (context.inFlight.current === operation) context.inFlight.current = null
  }
}
