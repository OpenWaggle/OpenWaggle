import { describe, expect, it } from 'vitest'
import {
  decodeSessionAuthoritySnapshot,
  encodeSessionAuthoritySnapshot,
  retargetSessionAuthoritySnapshot,
} from '../session-authority-snapshot'

describe('Session authority snapshots', () => {
  it('moves generated local roots but preserves named-profile policy roots', () => {
    const snapshot = {
      scope: {
        projectPaths: ['/project'],
        workspaceRoots: ['/old', '/explicit'],
        exportRoots: ['/old'],
        attachmentRoots: ['/old'],
      },
      projectPath: '/project',
      workingPath: '/old',
    }

    expect(retargetSessionAuthoritySnapshot(snapshot, '/new', 'local-user')).toEqual({
      ...snapshot,
      scope: {
        projectPaths: ['/project'],
        workspaceRoots: ['/new', '/explicit'],
        exportRoots: ['/new'],
        attachmentRoots: ['/new'],
      },
      workingPath: '/new',
    })
    expect(retargetSessionAuthoritySnapshot(snapshot, '/new', 'profile:restricted')).toEqual({
      ...snapshot,
      workingPath: '/new',
    })
    expect(retargetSessionAuthoritySnapshot(snapshot, '/new', 'transient-mcp:digest')).toEqual({
      ...snapshot,
      workingPath: '/new',
    })
  })

  it('round-trips transient machine workspace roots', () => {
    const snapshot = {
      scope: {
        workspaceRoots: ['/workspace'],
        attachmentRoots: ['/attachments'],
        exportRoots: ['/exports'],
      },
      projectPath: '/workspace/project',
      workingPath: '/workspace/project/worktree',
    }

    expect(decodeSessionAuthoritySnapshot(encodeSessionAuthoritySnapshot(snapshot))).toEqual(
      snapshot,
    )
  })

  it('rejects undeclared snapshot fields', () => {
    expect(() =>
      decodeSessionAuthoritySnapshot(
        JSON.stringify({
          scope: {},
          projectPath: '/workspace/project',
          workingPath: '/workspace/project/worktree',
          unexpected: true,
        }),
      ),
    ).toThrow()
  })
})
