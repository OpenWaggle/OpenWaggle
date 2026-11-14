import { matchBy } from '@diegogbrisa/ts-match'
import { OPENWAGGLE_EXTENSION_BROKER } from '@shared/constants/extension-broker'
import type {
  OpenWaggleExtensionSyntaxHighlightInput,
  OpenWaggleExtensionSyntaxHighlightResult,
} from '@shared/extension-sdk'
import { createPlainExtensionSyntaxResult } from '@shared/extension-sdk'
import type { ExtensionInvokeResult } from '@shared/types/extension-broker'
import { createRendererLogger } from '@/shared/lib/logger'
import type { ExtensionFrameParentMessage } from './extension-frame-bootstrap-validation'

const logger = createRendererLogger('extension-frame')

export interface PendingFrameSyntaxHighlight {
  readonly input: OpenWaggleExtensionSyntaxHighlightInput
  readonly resolve: (result: OpenWaggleExtensionSyntaxHighlightResult) => void
  readonly removeAbortListener: () => void
}

/** The frame's calls that wait on a result from the parent window, by request id. */
export interface PendingFrameCalls {
  readonly invocations: Map<string, (result: ExtensionInvokeResult) => void>
  readonly syntaxHighlights: Map<string, PendingFrameSyntaxHighlight>
}

type FrameResultMessage = Extract<
  ExtensionFrameParentMessage,
  { readonly type: 'invoke-result' | 'syntax-highlight-result' | 'invalid-result' }
>

function settleInvocation(
  pending: PendingFrameCalls,
  requestId: string,
  result: ExtensionInvokeResult,
) {
  const resolve = pending.invocations.get(requestId)
  if (!resolve) return
  pending.invocations.delete(requestId)
  resolve(result)
}

function settleSyntaxHighlight(
  pending: PendingFrameCalls,
  requestId: string,
  result: (
    input: OpenWaggleExtensionSyntaxHighlightInput,
  ) => OpenWaggleExtensionSyntaxHighlightResult,
) {
  const call = pending.syntaxHighlights.get(requestId)
  if (!call) return
  pending.syntaxHighlights.delete(requestId)
  call.removeAbortListener()
  call.resolve(result(call.input))
}

function settleInvalidResult(
  pending: PendingFrameCalls,
  message: Extract<FrameResultMessage, { readonly type: 'invalid-result' }>,
) {
  logger.warn('Extension frame received a result it cannot decode', {
    resultType: message.resultType,
    requestId: message.requestId,
    issuePaths: message.issuePaths,
  })
  if (message.resultType === 'invoke-result') {
    settleInvocation(pending, message.requestId, {
      ok: false,
      error: {
        code: OPENWAGGLE_EXTENSION_BROKER.FAILURE_CODE.TRANSPORT_FAILED,
        message: 'The host sent an invalid extension capability result.',
        ...(message.issuePaths.length === 0 ? {} : { issues: message.issuePaths }),
      },
    })
    return
  }
  settleSyntaxHighlight(pending, message.requestId, (input) =>
    createPlainExtensionSyntaxResult({
      ...input,
      diagnostic: 'The host sent an invalid syntax highlight result.',
    }),
  )
}

/** Settle the pending call a result message names; a result that failed its decode settles too. */
export function settleFrameResult(pending: PendingFrameCalls, message: FrameResultMessage) {
  matchBy(message, 'type')
    .with('invoke-result', (result) => settleInvocation(pending, result.requestId, result.result))
    .with('syntax-highlight-result', (result) =>
      settleSyntaxHighlight(pending, result.requestId, () => result.result),
    )
    .with('invalid-result', (result) => settleInvalidResult(pending, result))
    .exhaustive()
}
