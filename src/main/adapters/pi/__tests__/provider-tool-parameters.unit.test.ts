import type { ToolCall } from '@earendil-works/pi-ai/compat'
import { validateToolArguments } from '@earendil-works/pi-ai/utils/validation'
import type { McpJsonValue } from '@shared/types/mcp'
import { fromAny } from '@total-typescript/shoehorn'
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

function plain(value: unknown) {
  // TypeBox schemas carry symbols; serialize to the JSON the provider receives.
  return fromAny<SchemaRoot, unknown>(JSON.parse(JSON.stringify(value)))
}

function validate(schema: McpJsonValue, arguments_: ToolCall['arguments']) {
  const toolCall: ToolCall = { type: 'toolCall', id: 'call-1', name: 't', arguments: arguments_ }
  const validated: unknown = validateToolArguments(
    { name: 't', description: 't', parameters: toProviderToolParameters(schema) },
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

const DISCRIMINATED_SCHEMA = {
  type: 'object',
  oneOf: [
    { properties: { kind: { const: 'a' }, value: { type: 'string' } }, required: ['kind'] },
    { properties: { kind: { const: 'b' }, value: { type: 'number' } }, required: ['kind'] },
  ],
} satisfies McpJsonValue

const DISCRIMINATED_CASES: readonly {
  readonly label: string
  readonly arguments_: ToolCall['arguments']
}[] = [
  { label: 'first', arguments_: { kind: 'a', value: 'x' } },
  { label: 'second', arguments_: { kind: 'b', value: 5 } },
]

interface UnevaluatedCase {
  readonly label: string
  readonly schema: McpJsonValue
  readonly arguments_: ToolCall['arguments']
}

// Each argument is only evaluated by a removed combinator (patternProperties is not
// hoisted), so keeping `unevaluatedProperties: false` would reject it.
const UNEVALUATED_CASES: readonly UnevaluatedCase[] = [
  {
    label: 'allOf',
    schema: {
      type: 'object',
      allOf: [{ patternProperties: { '^x-': { type: 'string' } } }],
      unevaluatedProperties: false,
    },
    arguments_: { 'x-a': 'x' },
  },
  {
    label: 'anyOf',
    schema: {
      type: 'object',
      properties: { kind: { type: 'string' } },
      anyOf: [
        { patternProperties: { '^x-': { type: 'string' } } },
        { properties: { b: { type: 'string' } } },
      ],
      unevaluatedProperties: false,
    },
    arguments_: { kind: 'k', 'x-a': 'x' },
  },
]

const OPEN_FALLBACK_CASES: readonly SchemaCase[] = [
  { label: 'missing', schema: undefined },
  { label: 'array', schema: [] },
  { label: 'string root', schema: { type: 'string' } },
  { label: 'untyped union', schema: { anyOf: [{ type: 'object' }] } },
]

describe('provider tool parameters for external MCP schemas', () => {
  it.each(ROOT_KEYWORD_CASES)(
    'drops a root $keyword that providers reject and keeps the argument shape',
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

      expect(root[keyword]).toBeUndefined()
      expect(root).toEqual({
        type: 'object',
        properties: PROPERTIES,
        // allOf members are conjunctive, so their required fields stay required.
        required: keyword === 'allOf' ? ['b', 'a'] : ['b'],
        description: 'd',
      })
    },
  )

  it('passes a provider-safe object schema through unchanged', () => {
    const schema = {
      type: 'object',
      properties: PROPERTIES,
      required: ['a'],
      additionalProperties: false,
    } satisfies McpJsonValue

    expect(plain(toProviderToolParameters(schema))).toEqual(schema)
  })

  it('hoists allOf member properties and required fields; the root definition wins', () => {
    const root = plain(
      toProviderToolParameters({
        type: 'object',
        properties: { kind: { type: 'string' }, a: { type: 'number' } },
        allOf: [{ properties: { a: { type: 'string' }, c: { type: 'string' } }, required: ['c'] }],
      }),
    )

    expect(root).toEqual({
      type: 'object',
      properties: { kind: { type: 'string' }, a: { type: 'number' }, c: { type: 'string' } },
      required: ['c'],
    })
  })

  it('hoists what each anyOf/oneOf alternative allows without hoisting their required fields', () => {
    const root = plain(
      toProviderToolParameters({
        type: 'object',
        oneOf: [
          {
            properties: { kind: { const: 'search' }, query: { type: 'string' } },
            required: ['kind', 'query'],
          },
          {
            properties: { kind: { const: 'fetch' }, url: { type: 'string' } },
            required: ['kind', 'url'],
            additionalProperties: false,
          },
        ],
      }),
    )

    expect(root).toEqual({
      type: 'object',
      properties: {
        kind: { anyOf: [{ const: 'search' }, { const: 'fetch' }] },
        // The search alternative leaves url unconstrained; the closed fetch one forbids query.
        query: { type: 'string' },
        url: { anyOf: [{}, { type: 'string' }] },
      },
    })
  })

  it.each(DISCRIMINATED_CASES)(
    "accepts every $label alternative through Pi's argument validation, unchanged",
    ({ arguments_ }) => {
      expect(validate(DISCRIMINATED_SCHEMA, arguments_)).toEqual(arguments_)
    },
  )

  it('does not hoist a reference into a removed root keyword', () => {
    const root = plain(
      toProviderToolParameters({
        type: 'object',
        properties: { p: { $ref: '#/anyOf/0/$defs/P', description: 'kept' } },
        anyOf: [{ $defs: { P: { type: 'string' } } }],
      }),
    )

    expect(root.properties).toEqual({ p: { description: 'kept' } })
    expect(
      validate(
        {
          type: 'object',
          properties: { p: { $ref: '#/anyOf/0/$defs/P' } },
          anyOf: [{ $defs: { P: { type: 'string' } } }],
        },
        { p: 'x' },
      ),
    ).toEqual({ p: 'x' })
  })

  it.each(UNEVALUATED_CASES)(
    "keeps valid $label arguments passing Pi's argument validation",
    ({ schema, arguments_ }) => {
      expect(plain(toProviderToolParameters(schema)).unevaluatedProperties).toBeUndefined()
      expect(validate(schema, arguments_)).toEqual(arguments_)
    },
  )

  it.each(OPEN_FALLBACK_CASES)('falls back to an open object for a $label schema', ({ schema }) => {
    const root = plain(toProviderToolParameters(schema))

    expect(root.type).toBe('object')
    expect(root.anyOf).toBeUndefined()
    expect(root.properties).toBeUndefined()
  })
})
