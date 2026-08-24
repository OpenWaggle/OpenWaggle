import type { AgentAuthorizationScopeKey } from '@shared/types/agent-authorization-grants'
import type { AgentLoopInteraction } from '@shared/types/agent-loop-interaction'
import { SessionId } from '@shared/types/brand'
import { fromPartial } from '@total-typescript/shoehorn'
import { describe, expect, it } from 'vitest'
import {
  allowScopeChoices,
  isAuthorizationRequest,
  isPromptInteraction,
  queuedRequestCount,
  ribbonTargetLine,
} from '../agent-authorization-ribbon-model'

const SESSION_ID = SessionId('session-1')

const toolCallKey: AgentAuthorizationScopeKey = {
  capability: 'mcp.tool-call',
  requester: 'github-issues',
  requesterId: 'github-issues-id',
  resource: 'list_issues',
}

const samplingKey: AgentAuthorizationScopeKey = {
  capability: 'mcp.sampling',
  requester: 'github-issues',
  requesterId: 'github-issues-id',
}

/**
 * `fromPartial` rather than a cast: these cases deliberately vary `kind` and `purpose`, which selects
 * a different member of the interaction union, and the repository forbids type assertions.
 */
function interaction(overrides: Partial<AgentLoopInteraction> = {}): AgentLoopInteraction {
  return fromPartial({
    createdAt: 1,
    interactionId: 'i-1',
    kind: 'confirm',
    purpose: 'authorization',
    runId: 'run-1',
    scopeKey: toolCallKey,
    sessionId: SESSION_ID,
    source: 'pi-ui',
    title: 'Allow?',
    ...overrides,
  })
}

describe('isAuthorizationRequest', () => {
  it('accepts a confirm that declares the authorization purpose and carries a key', () => {
    expect(isAuthorizationRequest(interaction())).toBe(true)
  })

  it.each(['user-input', 'disclosure', 'external-navigation'] as const)(
    'rejects the %s purpose even when a key is present',
    (purpose) => {
      expect(isAuthorizationRequest(interaction({ purpose }))).toBe(false)
    },
  )

  it('rejects an authorization purpose with no key, since there is nothing to scope a grant to', () => {
    expect(isAuthorizationRequest(interaction({ scopeKey: undefined }))).toBe(false)
  })
})

describe('ribbonTargetLine', () => {
  it('names the resource when the key has one', () => {
    expect(ribbonTargetLine(toolCallKey)).toBe('list_issues · Run a tool')
  })

  it('falls back to the requester when the capability has no resource', () => {
    expect(ribbonTargetLine(samplingKey)).toBe('github-issues · Use your model')
  })
})

describe('allowScopeChoices', () => {
  it('offers session before project, narrowest first', () => {
    expect(allowScopeChoices(toolCallKey, 'myproject').map((choice) => choice.scope)).toEqual([
      'session',
      'project',
    ])
  })

  it('names the resource, the requester and the project in the standing choice', () => {
    const [, project] = allowScopeChoices(toolCallKey, 'myproject')

    expect(project?.label).toBe('Always allow list_issues for github-issues in myproject')
  })

  it('still describes the project when its name is unknown', () => {
    const [, project] = allowScopeChoices(toolCallKey, null)

    expect(project?.label).toBe('Always allow list_issues for github-issues in this project')
  })

  it('uses the requester as the target when there is no resource', () => {
    const [, project] = allowScopeChoices(samplingKey, 'myproject')

    expect(project?.label).toBe('Always allow github-issues for github-issues in myproject')
  })
})

describe('queuedRequestCount', () => {
  it('counts every blocking request behind the one on screen', () => {
    expect(
      queuedRequestCount([
        interaction({ interactionId: 'a' }),
        interaction({ interactionId: 'b' }),
        interaction({ interactionId: 'c' }),
      ]),
    ).toBe(2)
  })

  it('includes custom requests, which occupy the same composer area', () => {
    expect(
      queuedRequestCount([
        interaction({ interactionId: 'a' }),
        interaction({ customType: 'x', interactionId: 'b', kind: 'custom' }),
      ]),
    ).toBe(1)
  })

  it('ignores notifications, which block nothing', () => {
    expect(
      queuedRequestCount([
        interaction({ interactionId: 'a' }),
        interaction({ interactionId: 'n', kind: 'notify' }),
      ]),
    ).toBe(0)
  })

  it('never reports a negative count for an empty list', () => {
    expect(queuedRequestCount([])).toBe(0)
  })
})

describe('isPromptInteraction', () => {
  it.each(['confirm', 'select', 'input', 'editor'] as const)('accepts %s', (kind) => {
    expect(isPromptInteraction(interaction({ kind }))).toBe(true)
  })

  it.each(['notify', 'custom'] as const)('rejects %s', (kind) => {
    expect(isPromptInteraction(interaction({ kind }))).toBe(false)
  })
})
