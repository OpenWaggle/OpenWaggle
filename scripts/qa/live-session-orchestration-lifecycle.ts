import { type launchGui, stopChild } from './live-session-orchestration-support'
import { prepareQaProfileRemoval, shutdownSessionHostForQa } from './session-host-shutdown'

export interface LiveQaLifecycleState {
  gui: ReturnType<typeof launchGui> | null
  guiLogs: Array<() => string>
  passed: boolean
}

export interface CompleteLiveQaCleanupInput {
  readonly gui: ReturnType<typeof launchGui> | null
  readonly guiLogs: readonly (() => string)[]
  readonly passed: boolean
  readonly primaryFailure: { readonly error: unknown } | null
  readonly userDataRoot: string
}

interface LiveQaCleanupDependencies {
  readonly prepareProfileRemoval: typeof prepareQaProfileRemoval
  readonly shutdownHost: typeof shutdownSessionHostForQa
  readonly stopGui: typeof stopChild
}

const defaultLiveQaCleanupDependencies: LiveQaCleanupDependencies = {
  prepareProfileRemoval: prepareQaProfileRemoval,
  shutdownHost: shutdownSessionHostForQa,
  stopGui: stopChild,
}

export async function completeLiveQaCleanup(
  input: CompleteLiveQaCleanupInput,
  dependencies: LiveQaCleanupDependencies = defaultLiveQaCleanupDependencies,
) {
  const cleanupErrors: unknown[] = []
  let closeSucceeded = true
  if (input.gui !== null) {
    try {
      await dependencies.stopGui(input.gui.child)
    } catch (error) {
      closeSucceeded = false
      cleanupErrors.push(error)
    }
  }
  try {
    await dependencies.shutdownHost(
      input.userDataRoot,
      input.passed && closeSucceeded
        ? (ownership) => dependencies.prepareProfileRemoval(input.userDataRoot, ownership)
        : async () => undefined,
    )
  } catch (error) {
    cleanupErrors.push(error)
    closeSucceeded = false
  }

  if (!input.passed || !closeSucceeded) {
    console.error(
      `Live QA data retained at ${input.userDataRoot}\n${input.guiLogs.map((read) => read()).join('\n')}`,
    )
  }
  if (input.primaryFailure && cleanupErrors.length > 0) {
    throw new AggregateError(
      [input.primaryFailure.error, ...cleanupErrors],
      'Live Session orchestration QA and its cleanup both failed.',
    )
  }
  if (input.primaryFailure) throw input.primaryFailure.error
  if (cleanupErrors.length === 1) throw cleanupErrors[0]
  if (cleanupErrors.length > 1) {
    throw new AggregateError(cleanupErrors, 'Live Session orchestration QA cleanup failed.')
  }
}

export async function runLiveQaProfileLifecycle(input: {
  readonly userDataRoot: string
  readonly state: LiveQaLifecycleState
  readonly run: () => Promise<void>
  readonly cleanup?: (input: CompleteLiveQaCleanupInput) => Promise<void>
}) {
  let primaryFailure: { readonly error: unknown } | null = null
  try {
    await input.run()
  } catch (error) {
    primaryFailure = { error }
  }
  await (input.cleanup ?? completeLiveQaCleanup)({
    gui: input.state.gui,
    guiLogs: input.state.guiLogs,
    passed: input.state.passed,
    primaryFailure,
    userDataRoot: input.userDataRoot,
  })
}
