import { safeDecodeUnknown } from '@shared/schema'
import {
  extensionApplyPackageWriteInputSchema,
  extensionProposePackageWriteInputSchema,
} from '@shared/schemas/extensions'
import { describe, expect, it } from 'vitest'

const files = [
  {
    relativePath: 'openwaggle.extension.json',
    content: '{}',
  },
]

describe('extension package write workflow schemas', () => {
  it('accepts package write proposal inputs for agent-authored project packages', () => {
    const result = safeDecodeUnknown(extensionProposePackageWriteInputSchema, {
      extensionId: 'sample-extension',
      scope: { kind: 'project', projectPath: '/tmp/project' },
      mode: 'create',
      files,
      actor: { kind: 'agent', agentId: 'agent-1', sessionId: 'session-1' },
      viewProjectPaths: ['/tmp/project'],
    })

    expect(result.success).toBe(true)
  })

  it('accepts approved package write inputs with global-impact confirmation', () => {
    const proposalHash = 'a'.repeat(64)
    const result = safeDecodeUnknown(extensionApplyPackageWriteInputSchema, {
      extensionId: 'sample-extension',
      scope: { kind: 'global' },
      mode: 'update',
      files,
      actor: { kind: 'agent', agentId: 'agent-1' },
      userApproval: {
        approved: true,
        approvedProposalHash: proposalHash,
        approvedBy: 'User',
        approvedAt: 1000,
      },
      globalConfirmation: {
        confirmed: true,
        confirmedExtensionId: 'sample-extension',
        confirmedProposalHash: proposalHash,
        risk: 'global-extension-package-write',
      },
    })

    expect(result.success).toBe(true)
  })

  it('rejects unsafe package file paths before package write workflows run', () => {
    const result = safeDecodeUnknown(extensionProposePackageWriteInputSchema, {
      extensionId: 'sample-extension',
      scope: { kind: 'project', projectPath: '/tmp/project' },
      mode: 'create',
      files: [{ relativePath: '../escape.js', content: 'export {}' }],
      actor: { kind: 'agent', agentId: 'agent-1' },
    })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.issues.join('\n')).toContain('files.0.relativePath')
    }
  })

  it('rejects malformed approval hashes', () => {
    const result = safeDecodeUnknown(extensionApplyPackageWriteInputSchema, {
      extensionId: 'sample-extension',
      scope: { kind: 'global' },
      mode: 'create',
      files,
      actor: { kind: 'agent', agentId: 'agent-1' },
      userApproval: {
        approved: true,
        approvedProposalHash: 'short',
        approvedBy: 'User',
        approvedAt: 1000,
      },
    })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.issues.join('\n')).toContain('approvedProposalHash')
    }
  })
})
