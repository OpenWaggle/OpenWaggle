import type { AgentKernelRunInput } from '../../../../ports/agent-kernel-service'
import { buildPiRunNewMessages } from '../../pi-run-result'

/** A classic Run's input for `runSubscribedPiOperation`, with its default new messages. */
export function classicRunInput(runInput: AgentKernelRunInput) {
  return {
    runInput,
    buildSuccessMessages: (appended: readonly unknown[]) =>
      buildPiRunNewMessages(runInput.payload, appended),
  }
}
