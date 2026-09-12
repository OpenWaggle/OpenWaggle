import { DELEGATION_STATES } from '@shared/types/session-collaboration'
import {
  DELEGATION_CONFLICT_KINDS,
  DELEGATION_CONFLICT_STATUSES,
} from '@shared/types/session-delegation-query'
import { SESSION_EXPORT_OPERATION_STATUSES } from '@shared/types/session-export-operation'
import { Check } from 'typebox/value'
import { describe, expect, it } from 'vitest'
import { sessionsToolParameters } from '../sessions-tool-parameters'
import { buildSessionsToolPayload } from '../sessions-tool-payload'

const source = { sessionId: 'queen', runId: 'run-queen', workingDirectory: '/workspace' }
const filters = [
  {
    base: { action: 'exports_list', sessionId: 'queen' },
    field: 'statuses',
    values: SESSION_EXPORT_OPERATION_STATUSES,
  },
  { base: { action: 'delegations_list' }, field: 'states', values: DELEGATION_STATES },
  {
    base: { action: 'delegations_conflicts' },
    field: 'kinds',
    values: DELEGATION_CONFLICT_KINDS,
  },
  {
    base: { action: 'delegations_conflicts' },
    field: 'statuses',
    values: DELEGATION_CONFLICT_STATUSES,
  },
] as const

describe('Pi Sessions finite filter contract', () => {
  it('accepts each complete finite vocabulary through the schema and payload builder', () => {
    const exportsInput = {
      action: 'exports_list' as const,
      sessionId: 'queen',
      statuses: [...SESSION_EXPORT_OPERATION_STATUSES],
    }
    const delegationsInput = {
      action: 'delegations_list' as const,
      catalogScope: 'all' as const,
      states: [...DELEGATION_STATES],
    }
    const conflictsInput = {
      action: 'delegations_conflicts' as const,
      catalogScope: 'all' as const,
      kinds: [...DELEGATION_CONFLICT_KINDS],
      statuses: [...DELEGATION_CONFLICT_STATUSES],
    }

    expect(Check(sessionsToolParameters, exportsInput)).toBe(true)
    expect(Check(sessionsToolParameters, delegationsInput)).toBe(true)
    expect(Check(sessionsToolParameters, conflictsInput)).toBe(true)
    expect(buildSessionsToolPayload(exportsInput, source)).toMatchObject({
      request: { query: { statuses: SESSION_EXPORT_OPERATION_STATUSES } },
    })
    expect(buildSessionsToolPayload(delegationsInput, source)).toMatchObject({
      request: { query: { states: DELEGATION_STATES } },
    })
    expect(buildSessionsToolPayload(conflictsInput, source)).toMatchObject({
      request: {
        query: {
          kinds: DELEGATION_CONFLICT_KINDS,
          statuses: DELEGATION_CONFLICT_STATUSES,
        },
      },
    })
  })

  it.each(filters)('bounds unique $field values to its exact vocabulary', (filter) => {
    expect(Check(sessionsToolParameters, { ...filter.base, [filter.field]: filter.values })).toBe(
      true,
    )
    expect(
      Check(sessionsToolParameters, {
        ...filter.base,
        [filter.field]: [filter.values[0], filter.values[0]],
      }),
    ).toBe(false)
    expect(
      Check(sessionsToolParameters, {
        ...filter.base,
        [filter.field]: [...filter.values, filter.values[0]],
      }),
    ).toBe(false)
  })

  it('deduplicates direct adapter inputs before Host decoding', () => {
    expect(
      buildSessionsToolPayload(
        { action: 'exports_list', sessionId: 'queen', statuses: ['queued', 'queued'] },
        source,
      ),
    ).toMatchObject({ request: { query: { statuses: ['queued'] } } })
    expect(
      buildSessionsToolPayload(
        {
          action: 'delegations_conflicts',
          catalogScope: 'all',
          kinds: ['live-overlap', 'live-overlap'],
          statuses: ['resolved', 'resolved'],
        },
        source,
      ),
    ).toMatchObject({
      request: { query: { kinds: ['live-overlap'], statuses: ['resolved'] } },
    })
  })
})
