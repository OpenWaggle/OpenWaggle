import type { AgentKernelRunInput } from '../../../ports/agent-kernel-service'
import { buildPiRunNewMessages } from '../pi-run-result'
import {
  createPiRunSessionRuntime,
  promptPiSession,
  runSubscribedPiOperation,
} from './run-lifecycle'
import { createSessionListener } from './session-listener'
import { resolveSessionProjectPath } from './session-manager'

export async function runPiSession(input: AgentKernelRunInput) {
  const projectPath = resolveSessionProjectPath(input.session)
  const { model, session } = await createPiRunSessionRuntime({
    session: input.session,
    projectPath,
    modelReference: input.model,
    payload: input.payload,
    skillToggles: input.skillToggles,
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
