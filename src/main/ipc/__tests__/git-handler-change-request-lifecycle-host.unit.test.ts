import { beforeEach, describe, expect, it } from 'vitest'
import {
  details,
  lifecycleMocks,
  registeredHandler,
  resetLifecycleHandlers,
} from './git-handler-change-request-lifecycle.test-harness'

describe('change request lifecycle through the Session Host', () => {
  beforeEach(resetLifecycleHandlers)

  it('serves the inspector from the Session Host, never the window’s isolated database', () => {
    // Regression: the window's database is client-isolated, so a window-local panel handler
    // found no Session and reported "does not belong to the opened Session" (ADR 0048).
    expect(lifecycleMocks.registrationKinds.get('git:change-request:panel')).toBe('host')
    expect(lifecycleMocks.registrationKinds.get('git:change-request:merge')).toBe('relaying')
  })

  it('lets the Session Host validate and merge when the window is attached to it', async () => {
    lifecycleMocks.showMessageBox.mockResolvedValue({ response: 1 })
    const merged = { ok: true, changeRequest: details({ state: 'merged' }) }
    lifecycleMocks.invokeConfiguredHostUi.mockImplementation(async (channel: unknown) =>
      channel === 'git:change-request:merge-candidate'
        ? {
            handled: true,
            result: {
              ok: true,
              candidate: {
                provider: 'github',
                account: null,
                title: 'Feature',
                headRef: 'feat',
                baseRef: 'main',
              },
            },
          }
        : { handled: true, result: merged },
    )
    const handler = registeredHandler('git:change-request:merge')

    const result = await handler?.({ sender: {} }, 'session-a', '/repo/session-a', {
      url: 'https://github.com/o/r/pull/7',
      expectedHeadCommit: 'abc123',
      method: 'squash',
    })

    expect(result).toMatchObject({ value: merged })
    expect(
      lifecycleMocks.invokeConfiguredHostUi.mock.calls.map((call: unknown[]) => call[0]),
    ).toEqual(['git:change-request:merge-candidate', 'git:change-request:merge-confirmed'])
    // The window's own database cannot see Sessions, so it must not judge ownership itself.
    expect(lifecycleMocks.verifySessionWorkingPath).not.toHaveBeenCalled()
    expect(lifecycleMocks.mergeChangeRequest).not.toHaveBeenCalled()
  })

  it('never asks the Host to merge after the window confirmation is cancelled', async () => {
    lifecycleMocks.invokeConfiguredHostUi.mockResolvedValue({
      handled: true,
      result: {
        ok: true,
        candidate: {
          provider: 'gitlab',
          account: 'jdoe_acme',
          title: 'Feature',
          headRef: 'feat',
          baseRef: 'main',
        },
      },
    })
    const handler = registeredHandler('git:change-request:merge')

    await expect(
      handler?.({ sender: {} }, 'session-a', '/repo/session-a', {
        url: 'https://github.com/o/r/pull/7',
        expectedHeadCommit: 'abc123',
        method: 'merge',
      }),
    ).resolves.toMatchObject({ ok: false, code: 'cancelled' })
    expect(lifecycleMocks.showMessageBox).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        title: 'Merge merge request',
        detail: expect.stringContaining('As: @jdoe_acme'),
      }),
    )
    expect(lifecycleMocks.invokeConfiguredHostUi).toHaveBeenCalledTimes(1)
  })

  it('reports the Provider account that read the request', async () => {
    const handler = registeredHandler('git:change-request:panel')

    await expect(
      handler?.({}, 'session-a', '/repo/session-a', 'https://github.com/o/r/pull/7'),
    ).resolves.toMatchObject({ ok: true, snapshot: { account: 'octocat' } })
  })

  it('returns a sign-in fix when the provider CLI is not signed in', async () => {
    lifecycleMocks.getChangeRequestDetails.mockResolvedValue({
      ok: false,
      code: 'not-authenticated',
      message: 'Not authenticated with GitHub.',
    })
    const handler = registeredHandler('git:change-request:panel')

    await expect(
      handler?.({}, 'session-a', '/repo/session-a', 'https://github.com/o/r/pull/7'),
    ).resolves.toMatchObject({
      ok: false,
      code: 'not-authenticated',
      attention: { kind: 'not-signed-in', provider: 'github', host: 'github.com', cli: 'gh' },
    })
  })

  it('keeps the fix the Session Host attached to a refused merge candidate', async () => {
    const attention = {
      kind: 'not-signed-in',
      provider: 'github',
      host: 'github.acme.io',
      cli: 'gh',
      environmentTokenIgnored: false,
      ignoredTokenVariables: [],
    }
    lifecycleMocks.invokeConfiguredHostUi.mockResolvedValue({
      handled: true,
      result: { ok: false, code: 'not-authenticated', message: 'Sign in', attention },
    })
    const handler = registeredHandler('git:change-request:merge')

    await expect(
      handler?.({ sender: {} }, 'session-a', '/repo/session-a', {
        url: 'https://github.acme.io/o/r/pull/7',
        expectedHeadCommit: 'abc123',
        method: 'merge',
      }),
    ).resolves.toMatchObject({ ok: false, attention })
    expect(lifecycleMocks.showMessageBox).not.toHaveBeenCalled()
  })
})
