import { fromAny } from '@total-typescript/shoehorn'
import { Check } from 'typebox/value'
import { describe, expect, it } from 'vitest'
import { sessionsToolSchemaForCapabilities } from '../sessions-tool-capability-schema'
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

  it('names the actions that require a property the flat schema leaves optional', () => {
    const shape = schemaShape(flattenSessionsToolParameters(sessionsToolParameterVariants))
    const objective = fromAny<{ description?: string }, unknown>(shape.properties?.objective)
    const projectPath = fromAny<{ description?: string }, unknown>(shape.properties?.projectPath)

    expect(objective.description).toBe('Required for launch, spawn.')
    // Optional for every action, so it names none; its own description explains catalogScope.
    expect(projectPath.description).not.toContain('Required for')
    expect(projectPath.description).toContain('only with catalogScope project')
    expect(shape.required).toEqual(['action'])
  })

  it('names only permitted actions in the required notes of a capability-filtered schema', () => {
    const shape = schemaShape(
      sessionsToolSchemaForCapabilities({
        capabilities: ['sessions:discover', 'sessions:read', 'sessions:spawn'],
        modelMultiAgentEnabled: true,
      }),
    )
    const objective = fromAny<{ description?: string }, unknown>(shape.properties?.objective)

    expect(objective.description).toBe('Required for spawn.')
  })

  it('keeps TypeBox internal keys out of the serialized provider schema', () => {
    const serialized = JSON.stringify(flattenSessionsToolParameters(sessionsToolParameterVariants))

    // Providers that reject unknown JSON Schema keywords would refuse the whole tool.
    expect(serialized).not.toMatch(/"~[A-Za-z]+"/)
  })

  it('still validates optional described properties after flattening', () => {
    const flat = flattenSessionsToolParameters(sessionsToolParameterVariants)

    expect(Check(flat, { action: 'launch', objective: 'Fix it' })).toBe(true)
    expect(Check(flat, { action: 'launch', objective: '' })).toBe(false)
  })

  it('enforces required fields for actions that share one parameter variant', () => {
    expect(() => assertSessionsToolActionArguments(asParams({ action: 'archive' }))).toThrow(
      /Invalid arguments for sessions action "archive"/,
    )
    expect(() =>
      assertSessionsToolActionArguments(asParams({ action: 'unarchive', sessionId: 'session-a' })),
    ).not.toThrow()
  })

  it('rejects unknown actions instead of passing them to the payload builders', () => {
    expect(() =>
      assertSessionsToolActionArguments(asParams({ action: '__no_permitted_actions__' })),
    ).toThrow(/Unknown sessions action/)
  })
})
