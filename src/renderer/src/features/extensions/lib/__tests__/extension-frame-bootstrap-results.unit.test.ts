import { EXTENSION_FRAME_MESSAGE_CHANNEL } from '@shared/constants/extension-frame'
import type { OpenWaggleExtensionSyntaxHighlightResult } from '@shared/extension-sdk'
import type { ExtensionInvokeResult } from '@shared/types/extension-broker'
import { describe, expect, it, vi } from 'vitest'
import { type PendingFrameCalls, settleFrameResult } from '../extension-frame-bootstrap-results'
import { decodedParentMessage } from '../extension-frame-bootstrap-validation'

function deliver(pending: PendingFrameCalls, message: object) {
  const decoded = decodedParentMessage(
    { channel: EXTENSION_FRAME_MESSAGE_CHANNEL, frameId: 'frame-1', ...message },
    'frame-1',
  )
  if (decoded === null || decoded.type === 'configure' || decoded.type === 'dispose') {
    throw new Error('Expected a result message.')
  }
  settleFrameResult(pending, decoded)
}

// Regression: a result that failed the strict decode was dropped before its request id was read,
// so the extension's await never settled.
describe('extension frame results that fail their decode', () => {
  it('settles the pending invoke with a failure that names the issue paths', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const settled: ExtensionInvokeResult[] = []
    const pending: PendingFrameCalls = {
      invocations: new Map([['invoke-1', (result) => settled.push(result)]]),
      syntaxHighlights: new Map(),
    }

    deliver(pending, {
      type: 'invoke-result',
      requestId: 'invoke-1',
      result: { ok: true, value: { capability: 'unknown' }, audit: { outcome: 'maybe' } },
    })

    expect(settled).toEqual([
      {
        ok: false,
        error: {
          code: 'transport-failed',
          message: 'The host sent an invalid extension capability result.',
          issues: expect.arrayContaining(['value.method: Missing']),
        },
      },
    ])
    expect(pending.invocations.size).toBe(0)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('"requestId":"invoke-1"'))
    warn.mockRestore()
  })

  it('settles the pending syntax highlight with the plain source', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const settled: OpenWaggleExtensionSyntaxHighlightResult[] = []
    const removeAbortListener = vi.fn()
    const pending: PendingFrameCalls = {
      invocations: new Map(),
      syntaxHighlights: new Map([
        [
          'syntax-1',
          {
            input: { source: 'const a = 1', language: 'typescript' },
            resolve: (result) => settled.push(result),
            removeAbortListener,
          },
        ],
      ]),
    }

    deliver(pending, {
      type: 'syntax-highlight-result',
      requestId: 'syntax-1',
      result: { status: 'highlighted', language: 'typescript', lines: [[{ content: 42 }]] },
    })

    expect(settled).toEqual([
      expect.objectContaining({
        status: 'plain-text',
        diagnostic: 'The host sent an invalid syntax highlight result.',
        lines: [[{ content: 'const a = 1' }]],
      }),
    ])
    expect(removeAbortListener).toHaveBeenCalledOnce()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('lines.0.0.content'))
    warn.mockRestore()
  })
})
