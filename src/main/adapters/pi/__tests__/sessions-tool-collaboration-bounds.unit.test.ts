import { SESSION_COLLABORATION_COLLECTION_LIMIT } from '@shared/session-collaboration-collections'
import { SESSION_REPORT_REFERENCE_MAX_LENGTH } from '@shared/session-report-reference'
import { Check } from 'typebox/value'
import { describe, expect, it } from 'vitest'
import { sessionsToolParameters } from '../sessions-tool-parameters'

function values(prefix: string, count: number) {
  return Array.from({ length: count }, (_, index) => `${prefix}-${String(index)}`)
}

describe('Pi Sessions collaboration collection boundaries', () => {
  it('matches the Host Worker-reference length boundary', () => {
    const input = (reference: string) => ({
      action: 'report',
      text: 'Status.',
      target: { type: 'worker_reference', reference },
    })
    expect(
      Check(sessionsToolParameters, input('r'.repeat(SESSION_REPORT_REFERENCE_MAX_LENGTH))),
    ).toBe(true)
    expect(
      Check(sessionsToolParameters, input('r'.repeat(SESSION_REPORT_REFERENCE_MAX_LENGTH + 1))),
    ).toBe(false)
  })

  it.each([
    {
      base: { action: 'spawn', objective: 'Bound the task.' },
      field: 'deliverables',
      values: values('deliverable', SESSION_COLLABORATION_COLLECTION_LIMIT),
    },
    {
      base: { action: 'report', text: 'Status.', target: { type: 'sessions' } },
      field: 'sessionIds',
      values: values('session', SESSION_COLLABORATION_COLLECTION_LIMIT),
      nested: true,
    },
  ] as const)('bounds unique $field values', ({ base, field, values: items, nested }) => {
    const input = nested
      ? { ...base, target: { ...base.target, [field]: items } }
      : { ...base, [field]: items }
    const oversized = nested
      ? { ...base, target: { ...base.target, [field]: [...items, 'one-too-many'] } }
      : { ...base, [field]: [...items, 'one-too-many'] }
    const duplicate = nested
      ? { ...base, target: { ...base.target, [field]: [items[0], items[0]] } }
      : { ...base, [field]: [items[0], items[0]] }
    expect(Check(sessionsToolParameters, input)).toBe(true)
    expect(Check(sessionsToolParameters, oversized)).toBe(false)
    expect(Check(sessionsToolParameters, duplicate)).toBe(false)
  })

  it.each([
    {
      base: { action: 'delegation_submit', delegationId: 'delegation', summary: 'Ready.' },
      field: 'evidence',
      values: values('evidence', SESSION_COLLABORATION_COLLECTION_LIMIT).map((summary) => ({
        kind: 'asserted-note' as const,
        summary,
      })),
    },
    {
      base: {
        action: 'delegation_claim',
        delegationId: 'delegation',
        reason: 'Coordinate.',
      },
      field: 'claims',
      values: values('claim', SESSION_COLLABORATION_COLLECTION_LIMIT).map((path) => ({
        access: 'write' as const,
        target: { type: 'workspace-file' as const, path },
      })),
    },
  ] as const)('bounds unique $field objects', ({ base, field, values: items }) => {
    expect(Check(sessionsToolParameters, { ...base, [field]: items })).toBe(true)
    expect(Check(sessionsToolParameters, { ...base, [field]: [...items, items[0]] })).toBe(false)
    expect(Check(sessionsToolParameters, { ...base, [field]: [items[0], items[0]] })).toBe(false)
  })

  it('applies the same string boundary to revised specifications', () => {
    const deliverables = values('deliverable', SESSION_COLLABORATION_COLLECTION_LIMIT)
    const base = {
      action: 'delegation_request_revision',
      delegationId: 'delegation',
      submissionRevision: 1,
      feedback: 'Add the complete checklist.',
    }
    const revisedSpecification = {
      objective: 'Revise the work.',
      deliverables,
      acceptanceCriteria: [],
      resourceReferences: [],
    }
    expect(Check(sessionsToolParameters, { ...base, revisedSpecification })).toBe(true)
    expect(
      Check(sessionsToolParameters, {
        ...base,
        revisedSpecification: { ...revisedSpecification, deliverables: [...deliverables, 'extra'] },
      }),
    ).toBe(false)
    expect(
      Check(sessionsToolParameters, {
        ...base,
        revisedSpecification: { ...revisedSpecification, deliverables: ['same', 'same'] },
      }),
    ).toBe(false)
  })
})
