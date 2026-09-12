import { SessionBranchId, SessionId } from '@shared/types/brand'
import type { SessionBranch } from '@shared/types/session'
import type { SessionResource } from '@shared/types/session-resource'
import { describe, expect, it } from 'vitest'
import {
  buildSessionResourceBranchNames,
  preferredResourceOccurrence,
  resolveResourceBranchName,
} from '../session-resource-browser'

function branch(id: string, name: string): SessionBranch {
  return {
    id: SessionBranchId(id),
    sessionId: SessionId('session-1'),
    sourceNodeId: null,
    headNodeId: null,
    name,
    isMain: false,
    createdAt: 1,
    updatedAt: 2,
  }
}

describe('session resource branch names', () => {
  it('resolves the current friendly name instead of the opaque branch id suffix', () => {
    const branchId = 'session-1:branch:source-node-7'
    const names = buildSessionResourceBranchNames([
      branch(branchId, 'Renamed resource investigation'),
    ])

    expect(resolveResourceBranchName(branchId, names)).toBe('Renamed resource investigation')
  })

  it('never exposes an unknown non-main branch id and safely recognizes main', () => {
    const names = buildSessionResourceBranchNames([])

    expect(resolveResourceBranchName('session-1:branch:source-node-7', names)).toBeNull()
    expect(resolveResourceBranchName('session-1:main', names)).toBe('main')
  })
})

describe('preferredResourceOccurrence', () => {
  const resource: SessionResource = {
    id: 'resource-1',
    sessionId: SessionId('session-1'),
    canonicalKey: 'file:resource-1',
    kind: 'file',
    title: 'notes.md',
    mimeType: 'text/markdown',
    locator: '/fallback/notes.md',
    managed: false,
    available: true,
    isSource: true,
    isOutput: true,
    occurrences: [
      {
        id: 'active-source',
        nodeId: 'active-node',
        branchId: 'session-1:main',
        actor: 'user',
        activity: 'provided',
        label: null,
        locator: '/active/notes.md',
        createdAt: 10,
      },
      {
        id: 'hidden-source',
        nodeId: 'hidden-node',
        branchId: 'session-1:branch:hidden',
        actor: 'agent',
        activity: 'read',
        label: null,
        locator: '/hidden/notes.md',
        createdAt: 30,
      },
      {
        id: 'active-output',
        nodeId: 'active-node',
        branchId: 'session-1:main',
        actor: 'agent',
        activity: 'updated',
        label: null,
        locator: '/active/output-notes.md',
        createdAt: 20,
      },
    ],
    createdAt: 10,
    updatedAt: 30,
  }

  it('prefers the latest matching occurrence on the active transcript path', () => {
    expect(preferredResourceOccurrence(resource, new Set(['active-node']), 'sources')?.id).toBe(
      'active-source',
    )
    expect(preferredResourceOccurrence(resource, new Set(['active-node']), 'outputs')?.id).toBe(
      'active-output',
    )
  })

  it('falls back to the latest matching occurrence when none belongs to the active path', () => {
    expect(preferredResourceOccurrence(resource, new Set(), 'sources')?.id).toBe('hidden-source')
    expect(preferredResourceOccurrence(resource, new Set(), null)?.id).toBe('hidden-source')
  })
})
