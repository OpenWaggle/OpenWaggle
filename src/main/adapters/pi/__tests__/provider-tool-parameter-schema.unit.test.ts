import { describe, expect, it } from 'vitest'
import {
  providerToolParameters,
  providerToolSchemaViolations,
} from '../provider-tool-parameter-schema'
import { compileToolArgumentsValidator } from '../tool-arguments-validator'

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
      properties: { a: { type: 'string' }, b: { type: 'number' } },
      required: ['a', 'b'],
    })
    expect(repairs).toEqual(['merged root allOf of 2 schemas', 'set root type missing to "object"'])
  })

  it('unions conflicting alternative properties and keeps a shared closed shape closed', () => {
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
        value: { anyOf: [{ type: 'string' }, { type: 'number' }] },
        unit: { type: 'string' },
      },
      required: ['value'],
      additionalProperties: false,
    })
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
      properties: { id: { type: 'string' } },
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
    expect(repairs).toEqual(['dropped root not; enforced when the tool runs'])
    if (!('validate' in compiled)) throw new Error(compiled.error)
    expect(compiled.validate({ a: 'x' })).toEqual([])
    expect(compiled.validate({ a: 'x', b: 'y' })).not.toEqual([])
  })

  it('requires nothing on behalf of a true alternative and tells the model it exists', () => {
    const { schema, repairs } = providerToolParameters({
      type: 'object',
      anyOf: [true, { properties: { a: { type: 'string' } }, required: ['a'] }],
    })

    expect(schema.required).toBeUndefined()
    expect(schema.description).toMatch(/2 shapes.*2\) any object/)
    expect(repairs).toContain('flattened root anyOf of 2 schemas')
  })

  it('stops flattening a combinator that references its own root', () => {
    const { schema, repairs } = providerToolParameters({
      type: 'object',
      properties: { a: { type: 'string' } },
      anyOf: [{ $ref: '#' }, { $ref: '#' }],
    })

    expect(schema).toMatchObject({ type: 'object', properties: { a: { type: 'string' } } })
    expect(repairs).toContain('stopped flattening recursive root combinators')
  })

  it.each(['object', 'string'])(
    'bounds the work a wide self-referencing combinator costs, reporting each repair once (%s root)',
    (type) => {
      const started = performance.now()
      const { repairs } = providerToolParameters({
        type,
        anyOf: Array.from({ length: 60 }, () => ({ $ref: '#' })),
      })

      // Unbounded, 60 self-references cost minutes; bounded, milliseconds.
      expect(performance.now() - started).toBeLessThan(3_000)
      expect(new Set(repairs).size).toBe(repairs.length)
    },
  )

  it('does not close the flattened root when a true alternative accepts any object', () => {
    const { schema } = providerToolParameters({
      type: 'object',
      anyOf: [true, { properties: { a: { type: 'string' } }, additionalProperties: false }],
    })

    expect(schema).not.toHaveProperty('additionalProperties')
  })
})
