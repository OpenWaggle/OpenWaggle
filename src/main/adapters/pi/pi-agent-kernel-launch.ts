import type {
  WorktreeLaunchEnvironment,
  WorktreeLaunchProgress,
} from '@shared/types/background-run'
import * as Effect from 'effect/Effect'
import { createLogger } from '../../logger'
import type { AgentKernelRunInput } from '../../ports/agent-kernel-service'
import type { InlineVisualizationServiceShape } from '../../ports/inline-visualization-service'
import type { McpDirectToolWaitOutcome } from '../../ports/mcp-runtime-service'
import { prepareSessionScratchDirectory } from '../../utils/session-scratch-directory'

const logger = createLogger('pi-agent-kernel')

/**
 * The finished MCP step's label when not every server it waited for connected. The turn goes ahead
 * without those servers' direct tools, and a check mark beside "Connecting MCP servers: figma"
 * would claim a connection that never happened.
 */
function settledToolsLabel(outcome: McpDirectToolWaitOutcome) {
  const parts = [
    ...(outcome.connected.length > 0 ? [`${outcome.connected.join(', ')} connected`] : []),
    ...(outcome.stillConnecting.length > 0
      ? [`${outcome.stillConnecting.join(', ')} still connecting`]
      : []),
    ...(outcome.unavailable.length > 0 ? [`${outcome.unavailable.join(', ')} unavailable`] : []),
  ]
  const incomplete = outcome.stillConnecting.length > 0 || outcome.unavailable.length > 0
  return incomplete ? `MCP servers: ${parts.join('; ')}` : undefined
}

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
    reportToolsConnected(outcome: McpDirectToolWaitOutcome) {
      if (!reportedTools) return
      const label = settledToolsLabel(outcome)
      onWorktreeLaunch?.({
        stage: 'connecting-tools',
        completesStep: true,
        ...(label ? { label } : {}),
        details: label ? [label] : [],
      })
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

/**
 * A missing scratch directory must not block the turn: tools then keep the Host's temp directory,
 * which is the behaviour before per-Session scratch directories existed.
 */
export function prepareScratchDirectory(sessionId: AgentKernelRunInput['session']['id']) {
  return Effect.tryPromise(() => prepareSessionScratchDirectory(sessionId)).pipe(
    Effect.catchAll((error) =>
      Effect.sync(() => {
        logger.warn('Failed to prepare the session scratch directory', {
          sessionId,
          error: String(error.error),
        })
        return undefined
      }),
    ),
  )
}
