import { fromAny } from '@total-typescript/shoehorn'
import { Check } from 'typebox/value'
import { describe, expect, it } from 'vitest'
import {
  assertSessionsToolActionArguments,
  flattenSessionsToolParameters,
  sessionsToolParameterVariants,
} from '../sessions-tool-flat-schema'
import type { SessionsToolParameters } from '../sessions-tool-parameters'

// The runtime receives whatever arguments survived provider parsing, so the fixtures below
// are intentionally incomplete relative to the static union type.
const asParams = (value: unknown) => fromAny<SessionsToolParameters, unknown>(value)

// The schema carries TypeBox symbols; serialize to a plain object to inspect its shape.
function schemaShape(schema: unknown) {
  return fromAny<
    {
      type?: string
      anyOf?: unknown[]
      properties?: Record<string, unknown>
      required?: string[]
    },
    unknown
  >(JSON.parse(JSON.stringify(schema)))
}

// Issue #218: GLM via OpenRouter silently emits `{}` tool arguments when the tool's
// parameter schema is a root-level anyOf union. The registered schema must stay flat.
describe('sessions tool flattened schema', () => {
  it('flattens the full variant list into a single object schema', () => {
    const shape = schemaShape(flattenSessionsToolParameters(sessionsToolParameterVariants))

    expect(shape.type).toBe('object')
    expect(shape.anyOf).toBeUndefined()
    expect(shape.properties?.action).toBeDefined()
    expect(shape.properties?.objective).toBeDefined()
    expect(shape.properties?.sessionId).toBeDefined()
  })

  it('still accepts valid action arguments against the union contract', () => {
    const schema = flattenSessionsToolParameters(sessionsToolParameterVariants)

    expect(Check(schema, { action: 'list' })).toBe(true)
    expect(Check(schema, { action: 'spawn', objective: 'test' })).toBe(true)
    expect(Check(schema, { action: 'bogus_action' })).toBe(false)
  })

  it('rejects calls that miss a variant-required field with a per-action error', () => {
    expect(() =>
      assertSessionsToolActionArguments(asParams({ action: 'spawn', objective: 'test' })),
    ).not.toThrow()

    expect(() => assertSessionsToolActionArguments(asParams({ action: 'spawn' }))).toThrow(
      /Invalid arguments for sessions action "spawn"/,
    )
    expect(() =>
      assertSessionsToolActionArguments(asParams({ action: 'search', query: 'queen' })),
    ).not.toThrow()
    expect(() => assertSessionsToolActionArguments(asParams({ action: 'search' }))).toThrow(
      /Invalid arguments for sessions action "search"/,
    )
  })

  it('rejects unknown actions instead of passing them to the payload builders', () => {
    expect(() =>
      assertSessionsToolActionArguments(asParams({ action: '__no_permitted_actions__' })),
    ).toThrow(/Unknown sessions action/)
  })
})
