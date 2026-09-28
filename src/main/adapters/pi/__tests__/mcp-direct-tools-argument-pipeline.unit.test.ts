import { describe, it } from 'vitest'
import {
  type ExpectedPipelineCase,
  expectPipelineCase,
} from './mcp-direct-tools-pipeline.test-utils'

// Every schema here needs repair before Bedrock or OpenAI accept it. Each case is one a
// flattened repair used as constraints mishandled: it rejected a valid call, dropped Pi's
// null clean-up or type coercion, or recursed forever.

const PIPELINE_CASES: readonly ExpectedPipelineCase[] = [
  {
    label: 'a field a closed alternative admits through patternProperties',
    expected: 'server',
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
    expected: 'server',
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
    expected: 'server',
    schema: {
      type: 'object',
      allOf: [{ patternProperties: { '^x-': { type: 'string' } } }],
      unevaluatedProperties: false,
    },
    arguments_: { 'x-a': 'x' },
  },
  {
    label: 'a value only root additionalProperties coerces',
    expected: 'server',
    schema: {
      type: 'object',
      additionalProperties: { type: 'number' },
      anyOf: [{ properties: { b: { enum: [1, 2] } }, required: ['b'] }],
    },
    arguments_: { b: '1' },
  },
  {
    label: 'an object missing a field only the constrained alternative requires',
    expected: 'server',
    schema: {
      type: 'object',
      anyOf: [true, { properties: { a: { type: 'string' } }, required: ['a'] }],
    },
    arguments_: {},
  },
  {
    label: 'an optional null in an untyped root',
    expected: 'server',
    schema: {
      properties: { q: { type: 'string' }, n: { type: 'number' } },
      required: ['q'],
    },
    arguments_: { q: 'x', n: null },
  },
  {
    label: 'a stringified number in an untyped root',
    expected: 'coerced',
    schema: { properties: { n: { type: 'number' } } },
    arguments_: { n: '5' },
  },
  {
    label: 'a stringified boolean beside a root not',
    expected: 'server',
    schema: { type: 'object', properties: { r: { type: 'boolean' } }, not: { required: ['z'] } },
    arguments_: { r: 'true' },
  },
  {
    label: 'a stringified integer in a discriminated oneOf',
    expected: 'coerced',
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
    expected: 'server',
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
    expected: 'server',
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
    label: 'a property only a dropped then marked evaluated',
    expected: 'server',
    schema: {
      type: 'object',
      properties: { kind: { type: 'string' } },
      if: { properties: { kind: { const: 'a' } } },
      ...Object.fromEntries([['then', { properties: { a: { type: 'string' } } }]]),
      unevaluatedProperties: false,
    },
    arguments_: { kind: 'a', a: 'x' },
  },
  {
    label: 'a pattern property once the missing root type is set',
    expected: 'server',
    schema: {
      properties: {},
      patternProperties: { '^x': { type: 'string' } },
      additionalProperties: { type: 'number' },
    },
    arguments_: { x1: '5' },
  },
  {
    label: 'a call missing the discriminator every alternative requires',
    expected: 'rejected',
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
    expected: 'rejected',
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
    'handle $label as Pi handles the server schema ($expected)',
    expectPipelineCase,
  )
})
