import { DELEGATION_STATES } from '@shared/types/session-collaboration'
import {
  DELEGATION_CONFLICT_KINDS,
  DELEGATION_CONFLICT_STATUSES,
} from '@shared/types/session-delegation-query'
import { SESSION_EXPORT_OPERATION_STATUSES } from '@shared/types/session-export-operation'
import { describe, expect, it } from 'vitest'
import { buildMcpSessionPayloadV2, sessionInputSchemaV2 } from '../openwaggle-mcp-session-tool-v2'

const filters = [
  {
    base: { operation: 'exports-list' },
    field: 'exportStatuses',
    values: SESSION_EXPORT_OPERATION_STATUSES,
  },
  {
    base: { operation: 'delegations-list', catalogScope: 'all' },
    field: 'states',
    values: DELEGATION_STATES,
  },
  {
    base: { operation: 'delegations-conflicts', catalogScope: 'all' },
    field: 'conflictKinds',
    values: DELEGATION_CONFLICT_KINDS,
  },
  {
    base: { operation: 'delegations-conflicts', catalogScope: 'all' },
    field: 'conflictStatuses',
    values: DELEGATION_CONFLICT_STATUSES,
  },
] as const

describe('OpenWaggle MCP Session finite filter contract', () => {
  it.each(filters)('bounds unique $field values to its exact vocabulary', (filter) => {
    expect(
      sessionInputSchemaV2.safeParse({ ...filter.base, [filter.field]: filter.values }).success,
    ).toBe(true)
    expect(
      sessionInputSchemaV2.safeParse({
        ...filter.base,
        [filter.field]: [filter.values[0], filter.values[0]],
      }).success,
    ).toBe(false)
    expect(
      sessionInputSchemaV2.safeParse({
        ...filter.base,
        [filter.field]: [...filter.values, filter.values[0]],
      }).success,
    ).toBe(false)
  })

  it('passes every complete finite vocabulary through the MCP payload builder', () => {
    const exportsInput = sessionInputSchemaV2.parse({
      operation: 'exports-list',
      sessionId: 'queen',
      exportStatuses: SESSION_EXPORT_OPERATION_STATUSES,
    })
    const delegationsInput = sessionInputSchemaV2.parse({
      operation: 'delegations-list',
      catalogScope: 'all',
      states: DELEGATION_STATES,
    })
    const conflictsInput = sessionInputSchemaV2.parse({
      operation: 'delegations-conflicts',
      catalogScope: 'all',
      conflictKinds: DELEGATION_CONFLICT_KINDS,
      conflictStatuses: DELEGATION_CONFLICT_STATUSES,
    })

    expect(buildMcpSessionPayloadV2(exportsInput)).toMatchObject({
      request: { query: { statuses: SESSION_EXPORT_OPERATION_STATUSES } },
    })
    expect(buildMcpSessionPayloadV2(delegationsInput)).toMatchObject({
      request: { query: { states: DELEGATION_STATES } },
    })
    expect(buildMcpSessionPayloadV2(conflictsInput)).toMatchObject({
      request: {
        query: {
          kinds: DELEGATION_CONFLICT_KINDS,
          statuses: DELEGATION_CONFLICT_STATUSES,
        },
      },
    })
  })

  it('deduplicates direct builder inputs before Host decoding', () => {
    expect(
      buildMcpSessionPayloadV2({
        operation: 'delegations-list',
        catalogScope: 'all',
        states: ['working', 'working'],
      }),
    ).toMatchObject({ request: { query: { states: ['working'] } } })
    expect(
      buildMcpSessionPayloadV2({
        operation: 'delegations-conflicts',
        catalogScope: 'all',
        conflictKinds: ['live-overlap', 'live-overlap'],
        conflictStatuses: ['resolved', 'resolved'],
      }),
    ).toMatchObject({
      request: { query: { kinds: ['live-overlap'], statuses: ['resolved'] } },
    })
  })
})
