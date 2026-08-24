import type { ExtensionContext } from '@earendil-works/pi-coding-agent'
import { MCP_CONFIG } from '@shared/constants/mcp'
import type { McpJsonValue } from '@shared/types/mcp'
import {
  getOpenWaggleDeclaredConfirm,
  type OpenWaggleDeclaredConfirmPurpose,
} from './agent-kernel/openwaggle-authorize-channel'

const MAX_REVIEW_CHARACTERS = 20_000

export type JsonObject = Record<string, McpJsonValue>

export function isObject(value: McpJsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function stringValue(value: McpJsonValue | undefined) {
  return typeof value === 'string' ? value : undefined
}

export function numberValue(value: McpJsonValue | undefined) {
  return typeof value === 'number' ? value : undefined
}

export function reviewText(value: McpJsonValue) {
  const text = JSON.stringify(value, null, MCP_CONFIG.JSON_INDENT_SPACES)
  return text.length <= MAX_REVIEW_CHARACTERS
    ? text
    : `${text.slice(0, MAX_REVIEW_CHARACTERS)}\n… review truncated by UI safety limit`
}

export function interactionSignal(ctx: ExtensionContext, signal?: AbortSignal) {
  return signal ?? ctx.signal
}

export function requireUi(ctx: ExtensionContext, capability: string) {
  if (!ctx.hasUI) {
    throw new Error(`MCP ${capability} requires an interactive OpenWaggle approval.`)
  }
}

export function isLoopback(hostname: string) {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  return normalized === 'localhost' || normalized === '::1' || normalized.startsWith('127.')
}

/**
 * Raises a confirmation that declares its own purpose.
 *
 * Falls back to plain `confirm` when the OpenWaggle channel is absent. That fallback is `user-input`,
 * which also always prompts, so behaviour is unchanged and only the declared category is lost.
 */
export async function declaredConfirm(input: {
  readonly ctx: ExtensionContext
  readonly purpose: OpenWaggleDeclaredConfirmPurpose
  readonly title: string
  readonly message: string
  readonly signal?: AbortSignal
}): Promise<boolean> {
  const declared = getOpenWaggleDeclaredConfirm(input.ctx.ui)
  if (declared) {
    return declared({
      title: input.title,
      message: input.message,
      purpose: input.purpose,
      ...(input.signal ? { signal: input.signal } : {}),
    })
  }
  return input.ctx.ui.confirm(input.title, input.message, { signal: input.signal })
}
