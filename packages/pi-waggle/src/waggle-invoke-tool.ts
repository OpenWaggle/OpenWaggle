import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'
import type { WaggleConfig } from '@openwaggle/waggle-core'
import { Type } from 'typebox'
import { resolvePresetByReference } from './default-command-runtime.js'
import type { DefaultPiWaggleRunState } from './default-run.js'
import { PI_WAGGLE_USER_REQUEST_CUSTOM_TYPE } from './protocol.js'

export const WAGGLE_INVOKE_TOOL_NAME = 'waggle_invoke'

export interface PiWaggleHandoffRequest {
  readonly kind: 'waggle-handoff'
  readonly presetId: string
  readonly presetName: string
  readonly source: 'agent'
  readonly config: WaggleConfig
  readonly prompt: string
}

function isInsideWaggleRun(ctx: ExtensionContext) {
  const branch = ctx.sessionManager.getBranch()
  for (let index = branch.length - 1; index >= 0; index -= 1) {
    const entry = branch[index]
    if (!entry) continue
    if (entry.type === 'message' && entry.message.role === 'user') return false
    if (
      entry.type === 'custom_message' &&
      entry.customType === PI_WAGGLE_USER_REQUEST_CUSTOM_TYPE
    ) {
      return true
    }
  }
  return false
}

export function registerWaggleInvokeTool(
  pi: ExtensionAPI,
  input: { readonly getActiveRun: () => DefaultPiWaggleRunState | null },
) {
  pi.registerTool({
    name: WAGGLE_INVOKE_TOOL_NAME,
    label: 'Invoke Waggle',
    description:
      'Hand the current task to two collaborating Waggle agents using a preset. The preset may be an id or exact name. Built-ins: code-review, debate, red-team.',
    promptSnippet:
      'Use waggle_invoke when the task materially benefits from two-agent collaboration.',
    promptGuidelines: [
      'Invoke Waggle only when two-agent collaboration is useful, and pass a self-contained prompt.',
      'Call waggle_invoke as the only tool in its batch because it ends the current standard-agent turn.',
      'Do not invoke Waggle from inside an active Waggle collaboration.',
    ],
    parameters: Type.Object({
      preset: Type.String({
        description: 'Waggle preset id or exact preset name.',
        minLength: 1,
      }),
      prompt: Type.String({
        description: 'Self-contained task for the Waggle agents.',
        minLength: 1,
      }),
    }),
    executionMode: 'sequential',
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      if (signal?.aborted) throw new Error('aborted')
      if (input.getActiveRun() || isInsideWaggleRun(ctx)) {
        return {
          content: [{ type: 'text', text: 'Nested Waggle invocation is not supported.' }],
          details: { kind: 'waggle-invoke-rejected', reason: 'nested-waggle' },
          isError: true,
        }
      }

      const reference = params.preset.trim()
      const prompt = params.prompt.trim()
      const resolved = await resolvePresetByReference(ctx.cwd, reference)
      if (!resolved) {
        return {
          content: [{ type: 'text', text: `Waggle preset not found: ${reference}` }],
          details: { kind: 'waggle-invoke-rejected', reason: 'preset-not-found', reference },
          isError: true,
        }
      }
      if (!prompt) {
        return {
          content: [{ type: 'text', text: 'A non-empty Waggle prompt is required.' }],
          details: { kind: 'waggle-invoke-rejected', reason: 'empty-prompt' },
          isError: true,
        }
      }

      const details: PiWaggleHandoffRequest = {
        kind: 'waggle-handoff',
        presetId: resolved.preset.id,
        presetName: resolved.preset.name,
        source: 'agent',
        config: resolved.preset.config,
        prompt,
      }
      return {
        content: [
          {
            type: 'text',
            text: `Handing off to the ${resolved.preset.name} Waggle preset.`,
          },
        ],
        details,
        terminate: true,
      }
    },
  })
}
