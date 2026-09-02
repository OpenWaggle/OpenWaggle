import type { SyntaxWorkerRequest } from './protocol'
import { SYNTAX_REQUEST_TIMEOUT_MS } from './syntax-stream'
import { clearSyntaxWorkerSlotTimer, type SyntaxWorkerSlot } from './syntax-worker-slot'

export function dispatchSyntaxWorkerRequest(
  slot: SyntaxWorkerSlot,
  forceSource: boolean,
  onFailure: (message: string) => void,
) {
  const current = slot.current
  if (!current) return
  clearSyntaxWorkerSlotTimer(slot)
  const sendSource = forceSource || !slot.knownSourceKeys.has(current.sourceKey)
  slot.currentSourceSent = sendSource
  const message: SyntaxWorkerRequest = {
    type: 'highlight',
    requestId: current.requestId,
    ...(sendSource ? { source: current.input.source } : {}),
    sourceKey: current.sourceKey,
    language: current.input.language,
    theme: current.input.theme,
    ...(current.input.lineRange ? { lineRange: current.input.lineRange } : {}),
  }
  try {
    slot.worker.postMessage(message)
  } catch (error) {
    onFailure(error instanceof Error ? error.message : String(error))
    return
  }
  slot.timeout = window.setTimeout(() => {
    onFailure(`Syntax request exceeded ${String(SYNTAX_REQUEST_TIMEOUT_MS)} ms.`)
  }, SYNTAX_REQUEST_TIMEOUT_MS)
}
