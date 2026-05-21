export interface Deferred {
  readonly promise: Promise<void>
  readonly resolve: () => void
  readonly reject: (error: unknown) => void
}

export function createDeferred(): Deferred {
  let resolveCurrent: (() => void) | undefined
  let rejectCurrent: ((error: unknown) => void) | undefined
  const promise = new Promise<void>((resolve, reject) => {
    resolveCurrent = resolve
    rejectCurrent = reject
  })

  return {
    promise,
    resolve: () => resolveCurrent?.(),
    reject: (error) => rejectCurrent?.(error),
  }
}
