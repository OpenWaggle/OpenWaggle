import type {
  WorktreeLaunchEnvironment,
  WorktreeLaunchProgress,
} from '@shared/types/background-run'
import * as Effect from 'effect/Effect'
import { createLogger } from '../../logger'
import type { AgentKernelRunInput } from '../../ports/agent-kernel-service'
import type { InlineVisualizationServiceShape } from '../../ports/inline-visualization-service'

const logger = createLogger('pi-agent-kernel')

/**
 * Reports what a run does before Pi starts, so a first send is never silent.
 *
 * Steps are reported for a Session's first run, and for any later run that had to prepare its
 * worktree. An ordinary later turn reports nothing: its transcript already shows the run, and a
 * launch card on every turn flashed the transcript and the sidebar status.
 */
export function createWorktreeLaunchReporter(input: AgentKernelRunInput) {
  let didReport = false
  const environment: WorktreeLaunchEnvironment =
    input.session.environmentMode === 'worktree' ? 'worktree' : 'local'
  const firstRun = input.session.messages.length === 0
  let reportedTools = false
  let closed = false
  const onWorktreeLaunch = input.onWorktreeLaunch
    ? (progress: WorktreeLaunchProgress) => {
        // Once the pre-Pi phase is over, a late report could only revive a finished launch.
        if (closed) return
        didReport = true
        input.onWorktreeLaunch?.({ ...progress, environment: progress.environment ?? environment })
      }
    : undefined
  return {
    runInput: onWorktreeLaunch ? { ...input, onWorktreeLaunch } : input,
    report: onWorktreeLaunch,
    close() {
      closed = true
    },
    reportConnectingTools(serverNames: readonly string[]) {
      if (!firstRun && !didReport) return
      reportedTools = true
      onWorktreeLaunch?.({
        stage: 'connecting-tools',
        parallel: true,
        label: `Connecting MCP servers: ${serverNames.join(', ')}`,
        details: [`Connecting ${serverNames.join(', ')}`],
      })
    },
    reportToolsConnected() {
      if (!reportedTools) return
      onWorktreeLaunch?.({ stage: 'connecting-tools', completesStep: true, details: [] })
    },
    reportTaskStarting(executionPath: string) {
      if (!didReport) return
      onWorktreeLaunch?.({
        stage: 'starting-task',
        details: [
          environment === 'worktree'
            ? 'Starting the task in the new worktree'
            : 'Starting the task',
        ],
        ...(environment === 'worktree' ? { worktreePath: executionPath } : {}),
      })
      closed = true
    },
  }
}

export function prepareVisualizationDirectory(
  service: InlineVisualizationServiceShape,
  sessionId: AgentKernelRunInput['session']['id'],
) {
  return service.prepareSession(sessionId).pipe(
    Effect.catchAll((error) =>
      Effect.sync(() => {
        logger.warn('Failed to prepare the session visualization directory', {
          sessionId,
          error: error.message,
        })
        return undefined
      }),
    ),
  )
}
