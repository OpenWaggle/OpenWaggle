import { MAX_NODE_TIMER_DELAY_MS } from '@shared/constants/time'
import {
  SESSION_QUERY_MAX_CURSOR_LENGTH,
  SESSION_QUERY_MAX_PATH_LENGTH,
} from '@shared/types/session-query'
import { describe, expect, it } from 'vitest'
import { MCP_SESSION_INPUT_LIMITS_V2 } from '../openwaggle-mcp-session-resource-envelope-v2'

import { acceptsSessionInput } from './openwaggle-mcp-session-input.test-support'

describe('OpenWaggle MCP Session input bounds', () => {
  it('accepts the maximum cursor length and rejects larger values', () => {
    expect(
      acceptsSessionInput({
        operation: 'turns',
        cursor: 'c'.repeat(SESSION_QUERY_MAX_CURSOR_LENGTH),
      }),
    ).toBe(true)
    expect(
      acceptsSessionInput({
        operation: 'turns',
        cursor: 'c'.repeat(SESSION_QUERY_MAX_CURSOR_LENGTH + 1),
      }),
    ).toBe(false)
  })

  it('rejects oversized lifecycle and export paths', () => {
    expect(
      acceptsSessionInput({
        operation: 'create',
        projectPath: 'p'.repeat(SESSION_QUERY_MAX_PATH_LENGTH + 1),
      }),
    ).toBe(false)
    expect(
      acceptsSessionInput({
        operation: 'export-create',
        destinationPath: 'p'.repeat(SESSION_QUERY_MAX_PATH_LENGTH + 1),
      }),
    ).toBe(false)
  })

  it('uses operation-specific discovery and transcript limits', () => {
    expect(acceptsSessionInput({ operation: 'search', limit: 200 })).toBe(true)
    expect(acceptsSessionInput({ operation: 'search', limit: 201 })).toBe(false)
    expect(acceptsSessionInput({ operation: 'items', limit: 500 })).toBe(true)
    expect(acceptsSessionInput({ operation: 'items', limit: 501 })).toBe(false)
  })

  it('rejects known fields that do not belong to the selected operation', () => {
    expect(acceptsSessionInput({ operation: 'list', sessionId: 'ignored-session' })).toBe(false)
    expect(
      acceptsSessionInput({
        operation: 'spawn',
        exportResources: ['ignored-export-resource'],
      }),
    ).toBe(false)
    expect(acceptsSessionInput({ operation: 'report', workerSessionId: 'wrong-field' })).toBe(false)
  })

  it('bounds identifiers, messages, and titles at their exact public limits', () => {
    expect(
      acceptsSessionInput({
        operation: 'message',
        sessionId: 's'.repeat(MCP_SESSION_INPUT_LIMITS_V2.idLength),
        message: 'm'.repeat(MCP_SESSION_INPUT_LIMITS_V2.textLength),
      }),
    ).toBe(true)
    expect(
      acceptsSessionInput({
        operation: 'message',
        sessionId: 's'.repeat(MCP_SESSION_INPUT_LIMITS_V2.idLength + 1),
        message: 'valid',
      }),
    ).toBe(false)
    expect(
      acceptsSessionInput({
        operation: 'message',
        sessionId: 'valid',
        message: 'm'.repeat(MCP_SESSION_INPUT_LIMITS_V2.textLength + 1),
      }),
    ).toBe(false)
    expect(
      acceptsSessionInput({
        operation: 'rename',
        title: 't'.repeat(MCP_SESSION_INPUT_LIMITS_V2.titleLength + 1),
      }),
    ).toBe(false)
    expect(acceptsSessionInput({ operation: 'rename', title: '   ' })).toBe(false)
    expect(
      acceptsSessionInput({
        operation: 'rename',
        title: 't'.repeat(MCP_SESSION_INPUT_LIMITS_V2.titleLength),
      }),
    ).toBe(true)
  })

  it('bounds repeated task and resource fields including each nested item', () => {
    const maximumItems = Array.from(
      { length: MCP_SESSION_INPUT_LIMITS_V2.arrayItems },
      (_, index) => `item-${String(index)}`,
    )
    expect(
      acceptsSessionInput({
        operation: 'spawn',
        deliverables: maximumItems,
        resourceReferences: maximumItems,
      }),
    ).toBe(true)
    expect(
      acceptsSessionInput({
        operation: 'spawn',
        deliverables: [...maximumItems, 'one-too-many'],
      }),
    ).toBe(false)
    expect(
      acceptsSessionInput({
        operation: 'spawn',
        acceptanceCriteria: ['a'.repeat(MCP_SESSION_INPUT_LIMITS_V2.itemTextLength + 1)],
      }),
    ).toBe(false)
  })

  it('bounds evidence and revised Delegation specifications recursively', () => {
    expect(
      acceptsSessionInput({
        operation: 'delegation-submit',
        evidence: Array.from({ length: MCP_SESSION_INPUT_LIMITS_V2.evidenceItems }, (_, index) => ({
          kind: 'asserted-note',
          summary: `evidence-${String(index)}`,
        })),
      }),
    ).toBe(true)
    expect(
      acceptsSessionInput({
        operation: 'delegation-submit',
        evidence: Array.from(
          { length: MCP_SESSION_INPUT_LIMITS_V2.evidenceItems + 1 },
          (_, index) => ({ kind: 'asserted-note', summary: `evidence-${String(index)}` }),
        ),
      }),
    ).toBe(false)
    expect(
      acceptsSessionInput({
        operation: 'delegation-request-revision',
        revisedSpecification: {
          objective: 'Revise',
          deliverables: ['d'.repeat(MCP_SESSION_INPUT_LIMITS_V2.itemTextLength + 1)],
          acceptanceCriteria: [],
          resourceReferences: [],
        },
      }),
    ).toBe(false)
  })

  it('bounds custom interaction JSON by its serialized envelope', () => {
    expect(
      acceptsSessionInput({
        operation: 'request-respond',
        interactionResponse: {
          kind: 'custom',
          value: 'j'.repeat(MCP_SESSION_INPUT_LIMITS_V2.jsonLength - 2),
        },
      }),
    ).toBe(true)
    expect(
      acceptsSessionInput({
        operation: 'request-respond',
        interactionResponse: {
          kind: 'custom',
          value: 'j'.repeat(MCP_SESSION_INPUT_LIMITS_V2.jsonLength - 1),
        },
      }),
    ).toBe(false)
  })

  it('bounds text interaction responses', () => {
    expect(
      acceptsSessionInput({
        operation: 'request-respond',
        interactionResponse: {
          kind: 'editor',
          value: 'x'.repeat(MCP_SESSION_INPUT_LIMITS_V2.textLength),
        },
      }),
    ).toBe(true)
    expect(
      acceptsSessionInput({
        operation: 'request-respond',
        interactionResponse: {
          kind: 'editor',
          value: 'x'.repeat(MCP_SESSION_INPUT_LIMITS_V2.textLength + 1),
        },
      }),
    ).toBe(false)
  })

  it('rejects interaction timeouts that Node would coerce to one millisecond', () => {
    expect(
      acceptsSessionInput({
        operation: 'start',
        interactionTimeoutMs: MAX_NODE_TIMER_DELAY_MS,
      }),
    ).toBe(true)
    expect(
      acceptsSessionInput({
        operation: 'start',
        interactionTimeoutMs: MAX_NODE_TIMER_DELAY_MS + 1,
      }),
    ).toBe(false)
  })
})
