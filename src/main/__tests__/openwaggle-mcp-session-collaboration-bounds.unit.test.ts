import { SESSION_COLLABORATION_COLLECTION_LIMIT } from '@shared/session-collaboration-collections'
import { SESSION_REPORT_REFERENCE_MAX_LENGTH } from '@shared/session-report-reference'
import { describe, expect, it } from 'vitest'

import { acceptsSessionInput } from './openwaggle-mcp-session-input.test-support'

function values(prefix: string, count: number) {
  return Array.from({ length: count }, (_, index) => `${prefix}-${String(index)}`)
}

describe('OpenWaggle MCP collaboration collection boundaries', () => {
  it('matches the Host Worker-reference length boundary', () => {
    const input = (workerReference: string) => ({
      operation: 'report',
      reportTarget: 'worker-reference',
      workerReference,
      message: 'Status.',
    })
    expect(acceptsSessionInput(input('r'.repeat(SESSION_REPORT_REFERENCE_MAX_LENGTH)))).toBe(true)
    expect(acceptsSessionInput(input('r'.repeat(SESSION_REPORT_REFERENCE_MAX_LENGTH + 1)))).toBe(
      false,
    )
  })

  it('bounds unique report targets at the shared collaboration limit', () => {
    const sessionIds = values('session', SESSION_COLLABORATION_COLLECTION_LIMIT)
    const base = { operation: 'report', reportTarget: 'sessions', message: 'Status.' }
    expect(acceptsSessionInput({ ...base, targetSessionIds: sessionIds })).toBe(true)
    expect(
      acceptsSessionInput({
        ...base,
        targetSessionIds: [...sessionIds, 'one-too-many'],
      }),
    ).toBe(false)
    expect(acceptsSessionInput({ ...base, targetSessionIds: ['same', 'same'] })).toBe(false)
  })

  it('rejects oversized and duplicate evidence and claims', () => {
    const evidence = values('evidence', SESSION_COLLABORATION_COLLECTION_LIMIT).map((summary) => ({
      kind: 'asserted-note',
      summary,
    }))
    const claims = values('claim', SESSION_COLLABORATION_COLLECTION_LIMIT).map((path) => ({
      access: 'write',
      target: { type: 'workspace-file', path },
    }))
    for (const { input, field, items } of [
      {
        input: { operation: 'delegation-submit', evidence },
        field: 'evidence',
        items: evidence,
      },
      { input: { operation: 'delegation-claim', claims }, field: 'claims', items: claims },
    ] as const) {
      expect(acceptsSessionInput(input)).toBe(true)
      expect(acceptsSessionInput({ ...input, [field]: [...items, items[0]] })).toBe(false)
      expect(acceptsSessionInput({ ...input, [field]: [items[0], items[0]] })).toBe(false)
    }
  })

  it('rejects duplicate dependency identities even when required states differ', () => {
    const specification = {
      objective: 'Bound dependencies.',
      deliverables: [],
      acceptanceCriteria: [],
      dependencies: [
        { delegationId: 'same', requiredState: 'ready_for_review' },
        { delegationId: 'same', requiredState: 'accepted' },
      ],
      resourceReferences: [],
    }
    expect(
      acceptsSessionInput({
        operation: 'delegation-amend',
        delegationSpecification: specification,
      }),
    ).toBe(false)
  })

  it('applies the same string boundary to revised specifications', () => {
    const deliverables = values('deliverable', SESSION_COLLABORATION_COLLECTION_LIMIT)
    const base = {
      operation: 'delegation-request-revision',
      revisedSpecification: {
        objective: 'Revise the work.',
        deliverables,
        acceptanceCriteria: [],
        resourceReferences: [],
      },
    }
    expect(acceptsSessionInput(base)).toBe(true)
    expect(
      acceptsSessionInput({
        ...base,
        revisedSpecification: {
          ...base.revisedSpecification,
          deliverables: [...deliverables, 'one-too-many'],
        },
      }),
    ).toBe(false)
    expect(
      acceptsSessionInput({
        ...base,
        revisedSpecification: { ...base.revisedSpecification, deliverables: ['same', 'same'] },
      }),
    ).toBe(false)
  })
})
