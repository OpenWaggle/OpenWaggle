import type { ToolCall } from '@earendil-works/pi-ai/compat'
import { validateToolArguments } from '@earendil-works/pi-ai/utils/validation'
import { Type } from 'typebox'
import { describe, expect, it } from 'vitest'
import {
  compileToolArgumentsValidator,
  providerToolParameters,
  providerToolSchemaViolations,
} from '../provider-tool-parameter-schema'

describe('providerToolParameters', () => {
  it('returns a conforming schema as is, without repairs', () => {
    const schema = { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] }

    expect(providerToolParameters(schema)).toEqual({ schema, repairs: [] })
    expect(providerToolParameters(schema).schema).toBe(schema)
  })

  it('reports each root shape a provider rejects', () => {
    expect(providerToolSchemaViolations({ anyOf: [{ type: 'object' }] })).toEqual([
      'root type is missing, expected "object"',
      'root declares anyOf',
    ])
    expect(providerToolSchemaViolations({ type: 'object', enum: [{}] })).toEqual([
      'root declares enum',
    ])
    expect(providerToolSchemaViolations(true)).toEqual(['root schema is not a JSON object'])
  })

  it('merges allOf members, requiring what any member requires', () => {
    const { schema, repairs } = providerToolParameters({
      allOf: [
        { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] },
        { type: 'object', properties: { b: { type: 'number' } }, required: ['b'] },
      ],
    })

    expect(schema).toEqual({
      type: 'object',
      properties: {
        a: { anyOf: [{ type: 'string' }, {}] },
        b: { anyOf: [{ type: 'number' }, {}] },
      },
      required: ['a', 'b'],
    })
    expect(repairs).toEqual([
      'merged root allOf of 2 schemas',
      'set root type missing to "object"',
      'kept property definitions as guidance; enforced when the tool runs',
    ])
  })

  it('unions conflicting alternative properties and leaves closedness to call-time validation', () => {
    const { schema } = providerToolParameters({
      type: 'object',
      oneOf: [
        {
          properties: { value: { type: 'string' } },
          required: ['value'],
          additionalProperties: false,
        },
        {
          properties: { value: { type: 'number' }, unit: { type: 'string' } },
          required: ['value', 'unit'],
          additionalProperties: false,
        },
      ],
    })

    expect(schema).toMatchObject({
      type: 'object',
      properties: {
        value: { anyOf: [{ type: 'string' }, { type: 'number' }, {}] },
        unit: { anyOf: [{ type: 'string' }, {}] },
      },
      required: ['value'],
    })
    expect(schema).not.toHaveProperty('additionalProperties')
    expect(providerToolSchemaViolations(schema)).toEqual([])
  })

  it('follows chained root references and drops ones it cannot resolve', () => {
    expect(
      providerToolParameters({
        $ref: '#/definitions/Outer',
        definitions: {
          Outer: { $ref: '#/definitions/Inner', description: 'Outer' },
          Inner: { type: 'object', properties: { id: { type: 'string' } } },
        },
      }).schema,
    ).toMatchObject({
      type: 'object',
      properties: { id: { anyOf: [{ type: 'string' }, {}] } },
      description: 'Outer',
    })

    const remote = providerToolParameters({ $ref: 'https://example.com/schema.json' })
    expect(remote.schema).toEqual({ type: 'object' })
    expect(remote.repairs[0]).toBe('dropped unresolvable root $ref https://example.com/schema.json')
  })

  it('replaces a root that cannot describe an arguments object with an open object', () => {
    const { schema, repairs } = providerToolParameters({ type: 'array', description: 'Paths' })

    expect(schema).toEqual({ type: 'object', properties: {}, description: 'Paths' })
    expect(repairs).toEqual([
      'root type "array" cannot describe tool arguments; accepts any object',
    ])
  })

  it('drops root keywords providers reject and leaves them to call-time validation', () => {
    const original = {
      type: 'object',
      properties: { a: { type: 'string' }, b: { type: 'string' } },
      not: { required: ['a', 'b'] },
    }
    const { schema, repairs } = providerToolParameters(original)
    const compiled = compileToolArgumentsValidator(original)

    expect(schema).not.toHaveProperty('not')
    expect(repairs).toEqual([
      'dropped root not; enforced when the tool runs',
      'kept property definitions as guidance; enforced when the tool runs',
    ])
    if (!('validate' in compiled)) throw new Error(compiled.error)
    expect(compiled.validate({ a: 'x' })).toEqual([])
    expect(compiled.validate({ a: 'x', b: 'y' })).not.toEqual([])
  })
})

function piAccepts(schema: Record<string, unknown>, arguments_: ToolCall['arguments']) {
  const toolCall: ToolCall = { type: 'toolCall', id: 'call-1', name: 't', arguments: arguments_ }
  try {
    validateToolArguments(
      { name: 't', description: 't', parameters: Type.Unsafe<Record<string, unknown>>(schema) },
      toolCall,
    )
    return true
  } catch {
    return false
  }
}

interface AcceptedArgumentsCase {
  readonly label: string
  readonly schema: Record<string, unknown>
  readonly arguments_: ToolCall['arguments']
}

// Each argument is accepted by the original schema under Pi's validator. A repaired schema that
// keeps flattened definitions as constraints rejected every one of them, and Pi validates against
// the repaired schema before the tool runs, so the call never reached call-time validation.
const ACCEPTED_ARGUMENT_CASES: readonly AcceptedArgumentsCase[] = [
  {
    label: 'a property a closed alternative admits through patternProperties',
    schema: {
      type: 'object',
      anyOf: [
        { properties: { a: { type: 'number' } }, required: ['a'] },
        { patternProperties: { '^a$': { type: 'string' } }, additionalProperties: false },
      ],
    },
    arguments_: { a: 'x' },
  },
  {
    label: 'a pattern field when every alternative is closed',
    schema: {
      type: 'object',
      anyOf: [
        { properties: { a: { type: 'string' } }, additionalProperties: false },
        { patternProperties: { '^x_': { type: 'string' } }, additionalProperties: false },
      ],
    },
    arguments_: { x_1: 's' },
  },
  {
    label: 'an argument evaluated only by a removed combinator',
    schema: {
      type: 'object',
      allOf: [{ patternProperties: { '^x-': { type: 'string' } } }],
      unevaluatedProperties: false,
    },
    arguments_: { 'x-a': 'x' },
  },
  {
    label: 'additionalProperties referencing into a removed combinator',
    schema: {
      type: 'object',
      additionalProperties: { $ref: '#/allOf/0/properties/a' },
      allOf: [{ properties: { a: { type: 'string' } } }],
    },
    arguments_: { z: 'hi' },
  },
  {
    label: 'a $defs entry referencing into a removed combinator',
    schema: {
      type: 'object',
      $defs: { Item: { $ref: '#/anyOf/0/properties/a' } },
      properties: { x: { $ref: '#/$defs/Item' } },
      anyOf: [{ properties: { a: { type: 'string' } } }],
    },
    arguments_: { x: 'hi' },
  },
  {
    label: 'a hoisted property referencing into a removed combinator',
    schema: {
      type: 'object',
      anyOf: [{ properties: { a: { type: 'string' }, b: { $ref: '#/anyOf/0/properties/a' } } }],
    },
    arguments_: { b: 'hi' },
  },
  {
    label: 'a value only root additionalProperties coerced',
    schema: {
      type: 'object',
      additionalProperties: { type: 'number' },
      anyOf: [{ properties: { b: { enum: [1, 2] } }, required: ['b'] }],
    },
    arguments_: { b: '1' },
  },
  {
    label: 'an object missing a field only the constrained alternative requires',
    schema: {
      type: 'object',
      anyOf: [true, { properties: { a: { type: 'string' } }, required: ['a'] }],
    },
    arguments_: {},
  },
  {
    label: 'the second branch of a discriminated oneOf',
    schema: {
      type: 'object',
      oneOf: [
        { properties: { kind: { const: 'a' }, value: { type: 'string' } }, required: ['kind'] },
        { properties: { kind: { const: 'b' }, value: { type: 'number' } }, required: ['kind'] },
      ],
    },
    arguments_: { kind: 'b', value: 5 },
  },
]

describe("repaired schemas and Pi's pre-call validation", () => {
  it.each(ACCEPTED_ARGUMENT_CASES)('still accept $label', ({ schema, arguments_ }) => {
    expect(piAccepts(schema, arguments_)).toBe(true)

    expect(piAccepts(providerToolParameters(schema).schema, arguments_)).toBe(true)
  })

  it('still require the fields every accepted argument carries', () => {
    const { schema } = providerToolParameters({
      type: 'object',
      oneOf: [
        { properties: { kind: { const: 'a' } }, required: ['kind'] },
        { properties: { kind: { const: 'b' }, b: { type: 'string' } }, required: ['kind', 'b'] },
      ],
    })

    expect(schema.required).toEqual(['kind'])
    expect(piAccepts(schema, {})).toBe(false)
  })
})
