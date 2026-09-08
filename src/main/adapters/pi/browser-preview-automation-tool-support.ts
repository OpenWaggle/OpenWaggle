import { Buffer } from 'node:buffer'
import type { AgentToolResult, ExtensionContext } from '@earendil-works/pi-coding-agent'
import { BROWSER_PREVIEW_AUTOMATION_LIMITS } from '@shared/types/browser-preview-automation'
import type { Effect as EffectType } from 'effect/Effect'
import * as Effect from 'effect/Effect'
import { getOpenWaggleAuthorize } from './agent-kernel/openwaggle-authorize-channel'

const PREVIEW_REQUESTER_ID = 'openwaggle:browser-preview'
const PREVIEW_REQUESTER = 'OpenWaggle browser preview'
const APPROVAL_ARGUMENT_BYTES = 4 * 1_024

export interface BrowserPreviewToolDetails {
  readonly kind: 'browser-preview'
  readonly operation: string
  readonly result: unknown
}

function serialize(value: unknown): string {
  if (value === undefined) return '{}'
  const serialized = JSON.stringify(value)
  return serialized ?? 'null'
}

function boundedApprovalArguments(value: unknown) {
  const serialized = serialize(value)
  if (Buffer.byteLength(serialized) <= APPROVAL_ARGUMENT_BYTES) return serialized
  return `${serialized.slice(0, APPROVAL_ARGUMENT_BYTES)}…`
}

export async function authorizeBrowserPreviewTool(input: {
  readonly operation: string
  readonly params: unknown
  readonly ctx: ExtensionContext
  readonly signal?: AbortSignal
}) {
  if (!input.ctx.hasUI) {
    throw new Error('Browser preview automation requires an interactive OpenWaggle session.')
  }
  const title = `Allow ${input.operation}?`
  const message = [
    'This agent wants to access the collaborative browser preview.',
    `Action: ${input.operation}`,
    `Arguments: ${boundedApprovalArguments(input.params)}`,
  ].join('\n')
  const authorize = getOpenWaggleAuthorize(input.ctx.ui)
  if (authorize) {
    return authorize({
      title,
      message,
      scopeKey: {
        requesterId: PREVIEW_REQUESTER_ID,
        requester: PREVIEW_REQUESTER,
        capability: 'browser.preview',
        resource: input.operation,
      },
      ...(input.signal ? { signal: input.signal } : {}),
    })
  }
  return input.ctx.ui.confirm(title, `${message}\n\nThis approval applies only to this call.`, {
    signal: input.signal,
  })
}

export function deniedBrowserPreviewResult(
  operation: string,
): AgentToolResult<BrowserPreviewToolDetails> & { readonly isError: true } {
  return {
    content: [{ type: 'text', text: `Browser preview action "${operation}" was denied.` }],
    details: { kind: 'browser-preview', operation, result: null },
    isError: true,
  }
}

export function browserPreviewTextResult(
  operation: string,
  result: unknown,
): AgentToolResult<BrowserPreviewToolDetails> {
  const text = serialize(result)
  if (Buffer.byteLength(text) > BROWSER_PREVIEW_AUTOMATION_LIMITS.RESULT_BYTES) {
    throw new Error('Browser preview result exceeded the 64 KB result limit.')
  }
  return {
    content: [{ type: 'text', text }],
    details: { kind: 'browser-preview', operation, result },
  }
}

export function runBrowserPreviewEffect<A>(
  effect: EffectType<A, Error>,
  signal?: AbortSignal,
): Promise<A> {
  return Effect.runPromise(effect, signal ? { signal } : undefined)
}
