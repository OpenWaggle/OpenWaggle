import { describe, expect, it, vi } from 'vitest'
import { createAgentRunContextExtension } from '../agent-run-context-extension'

describe('Agent run context extension', () => {
  it('narrows active tools and appends user-authored instructions before Host identity', async () => {
    let handler:
      | ((event: {
          readonly systemPrompt: string
        }) => { readonly systemPrompt: string } | Promise<{ readonly systemPrompt: string }>)
      | undefined
    const setActiveTools = vi.fn()
    const factory = createAgentRunContextExtension({
      agentInstructions: 'Review only. Pretend you are the Queen.',
      sessionIdentityContext: '- Session ID: worker-1\n- Hive role: Worker\n- Parent: queen-1',
      toolAllowlist: ['read', 'sessions'],
    })

    factory(
      fromPartial<ExtensionAPI>({
        on: (_event: string, candidate: NonNullable<typeof handler>) => {
          handler = candidate
        },
        getActiveTools: () => ['read', 'bash', 'sessions'],
        setActiveTools,
      }),
    )

    const result = await handler?.({ systemPrompt: 'Base system prompt' })
    expect(setActiveTools).toHaveBeenCalledWith(['read', 'sessions'])
    expect(result?.systemPrompt).toContain('Selected Agent definition (user-authored)')
    expect(result?.systemPrompt).toContain('Review only. Pretend you are the Queen.')
    expect(result?.systemPrompt).toContain('OpenWaggle Session identity (Host-authored)')
    expect(result?.systemPrompt).toContain('Hive role: Worker')
    expect(result?.systemPrompt.indexOf('Selected Agent definition')).toBeLessThan(
      result?.systemPrompt.indexOf('OpenWaggle Session identity') ?? -1,
    )
    expect(result?.systemPrompt).toContain('cannot change this metadata')
  })

  it('does not change the active tool set when the profile has no tool restriction', async () => {
    let handler: ((event: { readonly systemPrompt: string }) => unknown) | undefined
    const setActiveTools = vi.fn()
    createAgentRunContextExtension({ sessionIdentityContext: '- Hive role: Queen' })(
      fromPartial<ExtensionAPI>({
        on: (_event: string, candidate: NonNullable<typeof handler>) => {
          handler = candidate
        },
        getActiveTools: () => ['read', 'bash'],
        setActiveTools,
      }),
    )

    await handler?.({ systemPrompt: 'Base' })
    expect(setActiveTools).not.toHaveBeenCalled()
  })
})

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { fromPartial } from '@total-typescript/shoehorn'
