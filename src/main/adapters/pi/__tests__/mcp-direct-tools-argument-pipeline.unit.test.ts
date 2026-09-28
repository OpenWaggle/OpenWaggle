import { describe, expect, it } from 'vitest'
import {
  type PipelineCase,
  piOnServerSchema,
  serverSchemaAccepts,
  throughRepairedTool,
} from './mcp-direct-tools-pipeline.test-utils'

// Every schema here needs repair before Bedrock or OpenAI accept it. Each case is one a
// flattened repair used as constraints mishandled: it rejected a valid call, dropped Pi's
// null clean-up or type coercion, or recursed forever.
const PIPELINE_CASES: readonly PipelineCase[] = [
  {
    label: 'a field a closed alternative admits through patternProperties',
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
    label: 'a field evaluated only by a removed combinator',
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
    label: 'a hoisted field referencing into a removed combinator',
    schema: {
      type: 'object',
      anyOf: [{ properties: { a: { type: 'string' }, b: { $ref: '#/anyOf/0/properties/a' } } }],
    },
    arguments_: { b: 'hi' },
  },
  {
    label: 'a value only root additionalProperties coerces',
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
    label: 'an optional null in an untyped root',
    schema: {
      properties: { q: { type: 'string' }, n: { type: 'number' } },
      required: ['q'],
    },
    arguments_: { q: 'x', n: null },
  },
  {
    label: 'a stringified number in an untyped root',
    schema: { properties: { n: { type: 'number' } } },
    arguments_: { n: '5' },
  },
  {
    label: 'a stringified boolean beside a root not',
    schema: { type: 'object', properties: { r: { type: 'boolean' } }, not: { required: ['z'] } },
    arguments_: { r: 'true' },
  },
  {
    label: 'a stringified integer in a discriminated oneOf',
    schema: {
      type: 'object',
      oneOf: [
        { properties: { kind: { const: 'a' }, limit: { type: 'integer' } }, required: ['kind'] },
        { properties: { kind: { const: 'b' } }, required: ['kind'] },
      ],
    },
    arguments_: { kind: 'a', limit: '10' },
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
  {
    label: 'a nested stringified number under a root allOf',
    schema: {
      allOf: [
        {
          type: 'object',
          properties: { opts: { type: 'object', properties: { n: { type: 'number' } } } },
        },
      ],
    },
    arguments_: { opts: { n: '3' } },
  },
  {
    label: 'a field referencing the root of a recursive schema',
    schema: {
      type: 'object',
      anyOf: [{ properties: { a: { type: 'string' }, child: { $ref: '#' } } }],
    },
    arguments_: { child: { a: 'x' } },
  },
  {
    label: 'a call missing the discriminator every alternative requires',
    schema: {
      type: 'object',
      oneOf: [
        { properties: { kind: { const: 'a' } }, required: ['kind'] },
        { properties: { kind: { const: 'b' } }, required: ['kind'] },
      ],
    },
    arguments_: {},
  },
  {
    label: 'a call that matches no alternative',
    schema: {
      anyOf: [
        {
          type: 'object',
          properties: { kind: { const: 'id' }, id: { type: 'string' } },
          required: ['kind', 'id'],
        },
        {
          type: 'object',
          properties: { kind: { const: 'url' }, url: { type: 'string' } },
          required: ['kind', 'url'],
        },
      ],
    },
    arguments_: { kind: 'id' },
  },
]

describe('repaired MCP direct tools through the agent loop', () => {
  it.each(PIPELINE_CASES)(
    'accept $label whenever Pi accepts it against the server schema',
    async ({ schema, arguments_ }) => {
      const onServerSchema = piOnServerSchema(schema, arguments_)
      const repaired = await throughRepairedTool(schema, arguments_)

      if (onServerSchema.accepted) {
        expect(repaired).toEqual(onServerSchema)
        return
      }
      if (!repaired.accepted) return
      // Accepted only through coercion, into arguments the server schema accepts exactly.
      expect(serverSchemaAccepts(schema, repaired.forwarded)).toBe(true)
    },
  )
})
