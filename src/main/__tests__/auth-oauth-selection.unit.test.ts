import type { OAuthFlowStatus } from '@shared/types/auth'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ProviderOAuthService } from '../ports/provider-oauth-service'

const MAX_STATUS_POLL_ATTEMPTS = 10
const STATUS_POLL_INTERVAL_MS = 0

interface SelectionState {
  selectedOption: string | undefined
}

const selectionState = vi.hoisted<SelectionState>(() => ({
  selectedOption: undefined,
}))

vi.mock('electron', () => ({
  shell: { openExternal: vi.fn().mockResolvedValue(undefined) },
}))

vi.mock('../logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn() }),
}))

vi.mock('../runtime', () => ({
  runAppEffect: (effect: Effect.Effect<unknown, unknown, ProviderOAuthService>) =>
    Effect.runPromise(
      Effect.provide(
        effect,
        Layer.succeed(
          ProviderOAuthService,
          ProviderOAuthService.of({
            listProviders: () => Effect.succeed(['openai']),
            login: (_provider, handlers) =>
              Effect.promise(async () => {
                selectionState.selectedOption = await handlers.onSelect({
                  message: 'Choose a sign-in method',
                  options: [
                    { id: 'browser', label: 'Browser login' },
                    { id: 'device-code', label: 'Device code' },
                  ],
                })
              }),
            logout: () => Effect.void,
            isConnected: () => Effect.succeed(false),
            getAccountInfo: (provider) =>
              Effect.succeed({
                provider,
                connected: false,
                label: 'Not connected',
              }),
          }),
        ),
      ),
    ),
}))

async function waitForSelectionStatus(statuses: readonly OAuthFlowStatus[]) {
  for (let attempt = 0; attempt < MAX_STATUS_POLL_ATTEMPTS; attempt += 1) {
    if (statuses.some((status) => status.type === 'awaiting-selection')) return
    await new Promise((resolve) => setTimeout(resolve, STATUS_POLL_INTERVAL_MS))
  }

  throw new Error('Timed out waiting for OAuth selection status')
}

describe('OAuth selection flow', () => {
  beforeEach(() => {
    selectionState.selectedOption = undefined
  })

  it('surfaces Pi OAuth choices and resolves with the selected option', async () => {
    const { startOAuth, submitCode } = await import('../auth')
    const statuses: OAuthFlowStatus[] = []
    const flow = startOAuth('openai', (status) => statuses.push(status))

    await waitForSelectionStatus(statuses)
    submitCode('openai', 'device-code')
    await flow

    const selectionStatus = statuses.find((status) => status.type === 'awaiting-selection')
    if (selectionStatus?.type !== 'awaiting-selection') {
      throw new Error('OAuth selection status was not emitted')
    }

    expect(selectionStatus.selection.options.map((option) => option.id)).toEqual([
      'browser',
      'device-code',
    ])
    expect(selectionState.selectedOption).toBe('device-code')
    expect(statuses).toContainEqual({ type: 'success', provider: 'openai' })
  })
})
