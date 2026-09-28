import type { ToolCall } from '@earendil-works/pi-ai/compat'
import { validateToolArguments } from '@earendil-works/pi-ai/utils/validation'
import type { McpJsonValue } from '@shared/types/mcp'
import { fromAny } from '@total-typescript/shoehorn'
import { Type } from 'typebox'
import { describe, expect, it } from 'vitest'
import { toProviderToolParameters } from '../provider-tool-parameters'

type SchemaRoot = { readonly type?: unknown } & Readonly<Record<string, unknown>>

interface SchemaCase {
  readonly label: string
  readonly schema: McpJsonValue | undefined
}

interface RootKeywordCase {
  readonly keyword: string
  readonly value: McpJsonValue
}

interface AcceptedArgumentsCase {
  readonly label: string
  readonly schema: McpJsonValue
  readonly arguments_: ToolCall['arguments']
}

function plain(value: unknown) {
  // TypeBox schemas carry symbols; serialize to the JSON the provider receives.
  return fromAny<SchemaRoot, unknown>(JSON.parse(JSON.stringify(value)))
}

function validateAgainst(
  parameters: ReturnType<typeof toProviderToolParameters>,
  arguments_: ToolCall['arguments'],
) {
  const toolCall: ToolCall = { type: 'toolCall', id: 'call-1', name: 't', arguments: arguments_ }
  const validated: unknown = validateToolArguments(
    { name: 't', description: 't', parameters },
    toolCall,
  )
  return validated
}

const PROPERTIES = { a: { type: 'string' }, b: { type: 'string' } } satisfies McpJsonValue

// Root keywords rejected by Claude (including on Amazon Bedrock) or OpenAI beside an
// object root; each was confirmed against the live provider API.
const ROOT_KEYWORD_CASES: readonly RootKeywordCase[] = [
  { keyword: 'anyOf', value: [{ required: ['a'] }] },
  { keyword: 'oneOf', value: [{ required: ['a'] }] },
  { keyword: 'allOf', value: [{ required: ['a'] }] },
  { keyword: 'not', value: { required: ['b'] } },
  { keyword: 'enum', value: [{ a: 'x' }] },
  { keyword: 'const', value: { a: 'x' } },
]

// Each argument is accepted by the original schema under Pi's validator. Every case is a
// counterexample a more literal rewrite (hoisting definitions as constraints) rejected.
const ACCEPTED_ARGUMENT_CASES: readonly AcceptedArgumentsCase[] = [
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
    label: 'a then branch referencing a removed combinator',
    schema: {
      type: 'object',
      anyOf: [{ properties: { a: { type: 'string' } } }],
      if: { required: ['a'] },
      // Built from entries: a literal `then` key trips the thenable-object lint.
      ...Object.fromEntries([['then', { $ref: '#/anyOf/0' }]]),
    },
    arguments_: { a: 'x' },
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
    label: 'an unconstrained boolean alternative',
    schema: { type: 'object', anyOf: [true, { properties: { a: { type: 'number' } } }] },
    arguments_: { a: 'x' },
  },
  {
    label: 'a null an alternative admits',
    schema: {
      type: 'object',
      anyOf: [
        { properties: { a: { type: 'string' } }, additionalProperties: false },
        { patternProperties: { '^a$': { type: 'null' } }, additionalProperties: false },
      ],
    },
    arguments_: { a: null },
  },
]

const OPEN_FALLBACK_CASES: readonly SchemaCase[] = [
  { label: 'missing', schema: undefined },
  { label: 'array', schema: [] },
  { label: 'string root', schema: { type: 'string' } },
  { label: 'untyped union', schema: { anyOf: [{ type: 'object' }] } },
]

describe('provider tool parameters for external MCP schemas', () => {
  it('passes a provider-safe object schema through unchanged', () => {
    const schema = {
      type: 'object',
      properties: PROPERTIES,
      required: ['a'],
      additionalProperties: false,
    } satisfies McpJsonValue

    expect(plain(toProviderToolParameters(schema))).toEqual(schema)
  })

  it.each(ROOT_KEYWORD_CASES)(
    'drops a root $keyword that providers reject and keeps each property as guidance',
    ({ keyword, value }) => {
      const root = plain(
        toProviderToolParameters({
          type: 'object',
          properties: PROPERTIES,
          required: ['b'],
          description: 'd',
          [keyword]: value,
        }),
      )

      expect(root).toEqual({
        type: 'object',
        description: 'd',
        properties: {
          a: { anyOf: [{ type: 'string' }, {}] },
          b: { anyOf: [{ type: 'string' }, {}] },
        },
        // Every alternative (here the only member) requires a, so accepted arguments carry it.
        required: ['anyOf', 'oneOf', 'allOf'].includes(keyword) ? ['b', 'a'] : ['b'],
      })
    },
  )

  it('collects every definition of a property and the fields every alternative requires', () => {
    const root = plain(
      toProviderToolParameters({
        type: 'object',
        additionalProperties: false,
        oneOf: [
          {
            properties: { kind: { const: 'search' }, query: { type: 'string' } },
            required: ['kind', 'query'],
          },
          {
            properties: {
              kind: { const: 'fetch' },
              url: { type: 'string', description: 'Page to fetch.' },
            },
            required: ['kind', 'url'],
          },
        ],
      }),
    )

    expect(root).toEqual({
      type: 'object',
      properties: {
        kind: { anyOf: [{ const: 'search' }, { const: 'fetch' }, {}] },
        query: { anyOf: [{ type: 'string' }, {}] },
        url: {
          description: 'Page to fetch.',
          anyOf: [{ type: 'string', description: 'Page to fetch.' }, {}],
        },
      },
      required: ['kind'],
    })
  })

  it.each(ACCEPTED_ARGUMENT_CASES)(
    "keeps Pi's argument validation accepting $label",
    ({ schema, arguments_ }) => {
      expect(() =>
        validateAgainst(Type.Unsafe<Record<string, unknown>>(fromAny(schema)), arguments_),
      ).not.toThrow()

      expect(() => validateAgainst(toProviderToolParameters(schema), arguments_)).not.toThrow()
    },
  )

  it.each(OPEN_FALLBACK_CASES)('falls back to an open object for a $label schema', ({ schema }) => {
    const root = plain(toProviderToolParameters(schema))

    expect(root.type).toBe('object')
    expect(root.anyOf).toBeUndefined()
    expect(root.properties).toBeUndefined()
  })
})
