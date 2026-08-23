import { describe, expect, it } from 'vitest'
import { isAuthorizationRequest } from '../agent-authorization-ribbon-model'
import { parseInteraction } from '../agent-loop-transcript-interactions'

/**
 * Rehydration from persisted history.
 *
 * A request replayed after a reload has to survive as an authorization request. Dropping the grant
 * key kept the purpose but made `isAuthorizationRequest` false, so the ribbon degraded to a plain
 * question and the user could no longer keep an approval they had just been offered.
 */
const persisted = {
  createdAt: 1,
  interactionId: 'auth-1',
  kind: 'confirm',
  message: 'Server: github-issues',
  purpose: 'authorization',
  runId: 'run-1',
  sessionId: 'session-1',
  source: 'pi-ui',
  title: 'Allow GitHub Issues to reach api.github.com?',
}

describe('rehydrating an authorization request', () => {
  it('restores the grant key so the scope choices survive a reload', () => {
    const parsed = parseInteraction({
      ...persisted,
      scopeKey: {
        capability: 'mcp.tool-call',
        requester: 'github-issues',
        resource: 'list_issues',
      },
    })

    expect(parsed).not.toBeNull()
    expect(parsed && isAuthorizationRequest(parsed)).toBe(true)
    expect(parsed?.kind === 'confirm' && parsed.scopeKey).toEqual({
      capability: 'mcp.tool-call',
      requester: 'github-issues',
      resource: 'list_issues',
    })
  })

  it('keeps a key that has no resource, such as sampling', () => {
    const parsed = parseInteraction({
      ...persisted,
      scopeKey: { capability: 'mcp.sampling', requester: 'github-issues' },
    })

    expect(parsed?.kind === 'confirm' && parsed.scopeKey).toEqual({
      capability: 'mcp.sampling',
      requester: 'github-issues',
    })
  })

  it('drops a key whose capability this build does not know, rather than inventing one', () => {
    // A newer build could persist a capability this one cannot enforce. Degrading to a prompt with no
    // scope choices is safe; keeping a partial key would match the wrong thing.
    const parsed = parseInteraction({
      ...persisted,
      scopeKey: { capability: 'shell.exec', requester: 'github-issues' },
    })

    expect(parsed?.kind === 'confirm' && parsed.scopeKey).toBeUndefined()
    expect(parsed && isAuthorizationRequest(parsed)).toBe(false)
  })

  it('never widens an unknown purpose into authorization', () => {
    const parsed = parseInteraction({ ...persisted, purpose: 'something-new' })

    expect(parsed?.kind === 'confirm' && parsed.purpose).toBe('user-input')
  })
})
