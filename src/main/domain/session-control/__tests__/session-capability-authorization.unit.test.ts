import type { LocalSessionProfileAuthority } from '@shared/types/local-session-profile'
import type { SessionControlMutationRequest } from '@shared/types/session-control'
import type { SessionLifecycleRequest } from '@shared/types/session-lifecycle'
import type { SessionQueryRequest } from '@shared/types/session-query'
import { describe, expect, it } from 'vitest'
import {
  authorizeSessionCapabilities,
  authorizeSessionTarget,
  requiredSessionControlCapabilities,
  requiredSessionLifecycleCapabilities,
  requiredSessionQueryCapabilities,
} from '../session-capability-authorization'

const authority: LocalSessionProfileAuthority = {
  profileId: 'profile-review',
  profileName: 'review-bot',
  capabilities: ['sessions:message', 'sessions:queue', 'sessions:steer'],
  scope: { projectPaths: ['/project'], sessionIds: ['session-explicit'] },
  authorizationCeiling: 'ask-for-approval',
}

describe('Session capability authorization', () => {
  it('maps control operations to their exact capabilities', () => {
    const promote: SessionControlMutationRequest['command'] = {
      operation: 'promote',
      sessionId: 'session-target',
      expectedRunId: 'run-target',
      followUpId: 'follow-up-target',
    }
    const replace: SessionControlMutationRequest['command'] = {
      operation: 'replace',
      sessionId: 'session-target',
      expectedRunId: 'run-target',
      input: { text: 'Replace it.', attachmentIds: [] },
    }

    expect(requiredSessionControlCapabilities(promote)).toEqual([
      'sessions:queue',
      'sessions:steer',
    ])
    expect(requiredSessionControlCapabilities(replace)).toEqual([
      'sessions:interrupt',
      'sessions:start',
    ])
    expect(
      authorizeSessionCapabilities(authority, requiredSessionControlCapabilities(promote)),
    ).toEqual({ authorized: true })
    expect(
      authorizeSessionCapabilities(authority, requiredSessionControlCapabilities(replace)),
    ).toEqual({
      authorized: false,
      code: 'capability_denied',
      missing: ['sessions:interrupt', 'sessions:start'],
    })
  })

  it('keeps atomic lifecycle requirements distinct', () => {
    const launch: SessionLifecycleRequest['command'] = {
      operation: 'launch',
      projectPath: '/project',
      workspace: { mode: 'local' },
      objective: 'Run it.',
      attachmentIds: [],
    }
    const spawn: SessionLifecycleRequest['command'] = {
      operation: 'spawn',
      parentSessionId: 'session-parent',
      expectedParentRunId: 'run-parent',
      workspace: { mode: 'share-parent' },
      delegation: {
        objective: 'Implement it.',
        deliverables: [],
        acceptanceCriteria: [],
        dependencies: [],
        resourceReferences: [],
      },
    }

    expect(requiredSessionLifecycleCapabilities(launch)).toEqual([
      'sessions:create',
      'sessions:start',
    ])
    expect(requiredSessionLifecycleCapabilities(spawn)).toEqual(['sessions:spawn'])
  })

  it('requires transcript read authority for full-transcript search', () => {
    const discovery: SessionQueryRequest['query'] = {
      operation: 'search',
      query: 'migration',
      limit: 20,
    }
    const fullTranscript: SessionQueryRequest['query'] = {
      ...discovery,
      searchScope: 'full-transcript',
    }

    expect(requiredSessionQueryCapabilities(discovery)).toEqual(['sessions:discover'])
    expect(requiredSessionQueryCapabilities(fullTranscript)).toEqual([
      'sessions:discover',
      'sessions:read',
    ])
    expect(
      authorizeSessionCapabilities(
        { ...authority, capabilities: ['sessions:discover'] },
        requiredSessionQueryCapabilities(fullTranscript),
      ),
    ).toEqual({
      authorized: false,
      code: 'capability_denied',
      missing: ['sessions:read'],
    })
  })

  it('authorizes explicit project, Session, Hive, or all-target scopes', () => {
    expect(authorizeSessionTarget(authority, { projectPath: '/project' })).toEqual({
      authorized: true,
    })
    expect(authorizeSessionTarget(authority, { sessionId: 'session-explicit' })).toEqual({
      authorized: true,
    })
    expect(authorizeSessionTarget(authority, { projectPath: '/other' })).toEqual({
      authorized: false,
      code: 'target_scope_denied',
    })
    expect(authorizeSessionTarget({ ...authority, scope: { all: true } }, {})).toEqual({
      authorized: true,
    })
  })
})
