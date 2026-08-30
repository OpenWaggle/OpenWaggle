import {
  SESSION_QUERY_MAX_CURSOR_LENGTH,
  SESSION_QUERY_MAX_PATH_LENGTH,
} from '@shared/types/session-query'
import { describe, expect, it } from 'vitest'
import { MCP_SESSION_INPUT_LIMITS_V2 } from '../openwaggle-mcp-session-resource-envelope-v2'
import { sessionInputSchemaV2 } from '../openwaggle-mcp-session-tool-v2'

describe('OpenWaggle MCP Session input bounds', () => {
  it('accepts the maximum cursor length and rejects larger values', () => {
    expect(
      sessionInputSchemaV2.safeParse({
        operation: 'turns',
        cursor: 'c'.repeat(SESSION_QUERY_MAX_CURSOR_LENGTH),
      }).success,
    ).toBe(true)
    expect(
      sessionInputSchemaV2.safeParse({
        operation: 'turns',
        cursor: 'c'.repeat(SESSION_QUERY_MAX_CURSOR_LENGTH + 1),
      }).success,
    ).toBe(false)
  })

  it('rejects oversized lifecycle and export paths', () => {
    expect(
      sessionInputSchemaV2.safeParse({
        operation: 'create',
        projectPath: 'p'.repeat(SESSION_QUERY_MAX_PATH_LENGTH + 1),
      }).success,
    ).toBe(false)
    expect(
      sessionInputSchemaV2.safeParse({
        operation: 'export-create',
        destinationPath: 'p'.repeat(SESSION_QUERY_MAX_PATH_LENGTH + 1),
      }).success,
    ).toBe(false)
  })

  it('uses operation-specific discovery and transcript limits', () => {
    expect(sessionInputSchemaV2.safeParse({ operation: 'search', limit: 200 }).success).toBe(true)
    expect(sessionInputSchemaV2.safeParse({ operation: 'search', limit: 201 }).success).toBe(false)
    expect(sessionInputSchemaV2.safeParse({ operation: 'items', limit: 500 }).success).toBe(true)
    expect(sessionInputSchemaV2.safeParse({ operation: 'items', limit: 501 }).success).toBe(false)
  })

  it('rejects known fields that do not belong to the selected operation', () => {
    expect(
      sessionInputSchemaV2.safeParse({ operation: 'list', sessionId: 'ignored-session' }).success,
    ).toBe(false)
    expect(
      sessionInputSchemaV2.safeParse({
        operation: 'spawn',
        exportResources: ['ignored-export-resource'],
      }).success,
    ).toBe(false)
    expect(
      sessionInputSchemaV2.safeParse({ operation: 'report', workerSessionId: 'wrong-field' })
        .success,
    ).toBe(false)
  })

  it('bounds identifiers, messages, and titles at their exact public limits', () => {
    expect(
      sessionInputSchemaV2.safeParse({
        operation: 'message',
        sessionId: 's'.repeat(MCP_SESSION_INPUT_LIMITS_V2.idLength),
        message: 'm'.repeat(MCP_SESSION_INPUT_LIMITS_V2.textLength),
      }).success,
    ).toBe(true)
    expect(
      sessionInputSchemaV2.safeParse({
        operation: 'message',
        sessionId: 's'.repeat(MCP_SESSION_INPUT_LIMITS_V2.idLength + 1),
        message: 'valid',
      }).success,
    ).toBe(false)
    expect(
      sessionInputSchemaV2.safeParse({
        operation: 'message',
        sessionId: 'valid',
        message: 'm'.repeat(MCP_SESSION_INPUT_LIMITS_V2.textLength + 1),
      }).success,
    ).toBe(false)
    expect(
      sessionInputSchemaV2.safeParse({
        operation: 'rename',
        title: 't'.repeat(MCP_SESSION_INPUT_LIMITS_V2.titleLength + 1),
      }).success,
    ).toBe(false)
  })

  it('bounds repeated task and resource fields including each nested item', () => {
    const maximumItems = Array.from(
      { length: MCP_SESSION_INPUT_LIMITS_V2.arrayItems },
      (_, index) => `item-${String(index)}`,
    )
    expect(
      sessionInputSchemaV2.safeParse({
        operation: 'spawn',
        deliverables: maximumItems,
        resourceReferences: maximumItems,
      }).success,
    ).toBe(true)
    expect(
      sessionInputSchemaV2.safeParse({
        operation: 'spawn',
        deliverables: [...maximumItems, 'one-too-many'],
      }).success,
    ).toBe(false)
    expect(
      sessionInputSchemaV2.safeParse({
        operation: 'spawn',
        acceptanceCriteria: ['a'.repeat(MCP_SESSION_INPUT_LIMITS_V2.itemTextLength + 1)],
      }).success,
    ).toBe(false)
  })

  it('bounds evidence and revised Delegation specifications recursively', () => {
    expect(
      sessionInputSchemaV2.safeParse({
        operation: 'delegation-submit',
        evidence: Array.from({ length: MCP_SESSION_INPUT_LIMITS_V2.evidenceItems }, (_, index) => ({
          kind: 'asserted-note',
          summary: `evidence-${String(index)}`,
        })),
      }).success,
    ).toBe(true)
    expect(
      sessionInputSchemaV2.safeParse({
        operation: 'delegation-submit',
        evidence: Array.from(
          { length: MCP_SESSION_INPUT_LIMITS_V2.evidenceItems + 1 },
          (_, index) => ({ kind: 'asserted-note', summary: `evidence-${String(index)}` }),
        ),
      }).success,
    ).toBe(false)
    expect(
      sessionInputSchemaV2.safeParse({
        operation: 'delegation-request-revision',
        revisedSpecification: {
          objective: 'Revise',
          deliverables: ['d'.repeat(MCP_SESSION_INPUT_LIMITS_V2.itemTextLength + 1)],
          acceptanceCriteria: [],
          resourceReferences: [],
        },
      }).success,
    ).toBe(false)
  })

  it('bounds custom interaction JSON by its serialized envelope', () => {
    expect(
      sessionInputSchemaV2.safeParse({
        operation: 'request-respond',
        interactionResponse: {
          kind: 'custom',
          value: 'j'.repeat(MCP_SESSION_INPUT_LIMITS_V2.jsonLength - 2),
        },
      }).success,
    ).toBe(true)
    expect(
      sessionInputSchemaV2.safeParse({
        operation: 'request-respond',
        interactionResponse: {
          kind: 'custom',
          value: 'j'.repeat(MCP_SESSION_INPUT_LIMITS_V2.jsonLength - 1),
        },
      }).success,
    ).toBe(false)
  })
})
