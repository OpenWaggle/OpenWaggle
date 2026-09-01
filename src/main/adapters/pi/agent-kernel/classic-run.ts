import type { ExtensionFactory } from '@earendil-works/pi-coding-agent'
import type { AgentKernelRunInput } from '../../../ports/agent-kernel-service'
import { buildPiRunNewMessages } from '../pi-run-result'
import {
  createPiRunSessionRuntime,
  promptPiSession,
  runSubscribedPiOperation,
} from './run-lifecycle'
import type { PiRuntimeExtensionIsolationInput } from './runtime-extension-isolation'
import { createSessionListener } from './session-listener'
import { captureTurnCheckpoint } from './turn-capture'

/**
 * Runs a classic (non-Waggle) Pi turn.
 *
 * `workingPath` is the tree this turn runs in, already resolved (and, for a worktree-mode
 * session, already born) by the caller. It is passed in rather than re-derived because
 * worktree birth is not idempotent against a stale in-memory session: it persists the new
 * path with SQL but does not mutate the `SessionDetail` it was given, so a second call would
 * still see `worktreePath` as null and try to create the same worktree twice - which fails,
 * because the directory now exists and the branch is already checked out there.
 */
export async function runPiSession(
  input: AgentKernelRunInput &
    PiRuntimeExtensionIsolationInput & {
      readonly workingPath: string
      readonly visualizationDirectory?: string
      readonly mcpExtensionFactory?: ExtensionFactory
    },
) {
  const projectPath = input.workingPath
  const { model, session } = await createPiRunSessionRuntime({
    session: input.session,
    projectPath,
    runId: input.runId,
    modelReference: input.model,
    payload: input.payload,
    signal: input.signal,
    onEvent: input.onEvent,
    skillToggles: input.skillToggles,
    enabledOpenWaggleExtensionPackages: input.enabledOpenWaggleExtensionPackages,
    enabledOpenWaggleExtensionPackagePaths: input.enabledOpenWaggleExtensionPackagePaths,
    ...(input.visualizationDirectory
      ? { visualizationDirectory: input.visualizationDirectory }
      : {}),
    recordOpenWaggleExtensionRuntimeFailure: input.recordOpenWaggleExtensionRuntimeFailure,
    ...(input.mcpExtensionFactory ? { extensionFactories: [input.mcpExtensionFactory] } : {}),
  })

  const unsubscribe = session.subscribe(createSessionListener(input, input.runId))
  const result = await runSubscribedPiOperation({
    runInput: input,
    session,
    unsubscribe,
    abortWarning: 'Failed to abort Pi session cleanly',
    preAbortWarning: 'Failed to abort pre-cancelled Pi session cleanly',
    operation: () => promptPiSession(session, model, input.payload),
    buildErrorMessages: (appended) => buildPiRunNewMessages(input.payload, appended),
  })

  // Best-effort per-turn checkpoint (WS7); never affects the run result.
  await captureTurnCheckpoint({ session: input.session, projectPath, runId: input.runId })

  return result
}
