import { SESSION_COLLABORATION_COLLECTION_LIMIT } from '@shared/session-collaboration-collections'
import { SESSION_REPORT_REFERENCE_MAX_LENGTH } from '@shared/session-report-reference'
import { describe, expect, it } from 'vitest'
import { sessionInputSchemaV2 } from '../openwaggle-mcp-session-tool-v2'

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
    expect(
      sessionInputSchemaV2.safeParse(input('r'.repeat(SESSION_REPORT_REFERENCE_MAX_LENGTH)))
        .success,
    ).toBe(true)
    expect(
      sessionInputSchemaV2.safeParse(input('r'.repeat(SESSION_REPORT_REFERENCE_MAX_LENGTH + 1)))
        .success,
    ).toBe(false)
  })

  it('bounds unique report targets at the shared collaboration limit', () => {
    const sessionIds = values('session', SESSION_COLLABORATION_COLLECTION_LIMIT)
    const base = { operation: 'report', reportTarget: 'sessions', message: 'Status.' }
    expect(sessionInputSchemaV2.safeParse({ ...base, targetSessionIds: sessionIds }).success).toBe(
      true,
    )
    expect(
      sessionInputSchemaV2.safeParse({
        ...base,
        targetSessionIds: [...sessionIds, 'one-too-many'],
      }).success,
    ).toBe(false)
    expect(
      sessionInputSchemaV2.safeParse({ ...base, targetSessionIds: ['same', 'same'] }).success,
    ).toBe(false)
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
      expect(sessionInputSchemaV2.safeParse(input).success).toBe(true)
      expect(
        sessionInputSchemaV2.safeParse({ ...input, [field]: [...items, items[0]] }).success,
      ).toBe(false)
      expect(
        sessionInputSchemaV2.safeParse({ ...input, [field]: [items[0], items[0]] }).success,
      ).toBe(false)
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
      sessionInputSchemaV2.safeParse({
        operation: 'delegation-amend',
        delegationSpecification: specification,
      }).success,
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
    expect(sessionInputSchemaV2.safeParse(base).success).toBe(true)
    expect(
      sessionInputSchemaV2.safeParse({
        ...base,
        revisedSpecification: {
          ...base.revisedSpecification,
          deliverables: [...deliverables, 'one-too-many'],
        },
      }).success,
    ).toBe(false)
    expect(
      sessionInputSchemaV2.safeParse({
        ...base,
        revisedSpecification: { ...base.revisedSpecification, deliverables: ['same', 'same'] },
      }).success,
    ).toBe(false)
  })
})
