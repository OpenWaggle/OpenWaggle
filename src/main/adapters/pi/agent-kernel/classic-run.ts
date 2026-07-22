import type { AgentKernelRunInput } from '../../../ports/agent-kernel-service'
import { buildPiRunNewMessages } from '../pi-run-result'
import {
  createPiRunSessionRuntime,
  promptPiSession,
  runSubscribedPiOperation,
} from './run-lifecycle'
import type { PiRuntimeExtensionIsolationInput } from './runtime-extension-isolation'
import { createSessionListener } from './session-listener'
import { resolveSessionProjectPath } from './session-manager'

export async function runPiSession(input: AgentKernelRunInput & PiRuntimeExtensionIsolationInput) {
  const projectPath = resolveSessionProjectPath(input.session)
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
    recordOpenWaggleExtensionRuntimeFailure: input.recordOpenWaggleExtensionRuntimeFailure,
  })

  const unsubscribe = session.subscribe(createSessionListener(input, input.runId))
  return runSubscribedPiOperation({
    runInput: input,
    session,
    unsubscribe,
    abortWarning: 'Failed to abort Pi session cleanly',
    preAbortWarning: 'Failed to abort pre-cancelled Pi session cleanly',
    operation: () => promptPiSession(session, model, input.payload),
    buildErrorMessages: (appended) => buildPiRunNewMessages(input.payload, appended),
  })
}
