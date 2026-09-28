import { describe, it } from 'vitest'
import {
  type ExpectedPipelineCase,
  expectPipelineCase,
} from './mcp-direct-tools-pipeline.test-utils'

// Schema references a repair can misread: into removed or dropped keywords, to the root, and
// inside nested `$id` resources, which resolve `#` against themselves.
const REFERENCE_CASES: readonly ExpectedPipelineCase[] = [
  {
    label: 'additionalProperties referencing into a removed combinator',
    expected: 'server',
    schema: {
      type: 'object',
      additionalProperties: { $ref: '#/allOf/0/properties/a' },
      allOf: [{ properties: { a: { type: 'string' } } }],
    },
    arguments_: { z: 'hi' },
  },
  {
    label: 'a $defs entry referencing into a removed combinator',
    expected: 'server',
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
    expected: 'server',
    schema: {
      type: 'object',
      anyOf: [{ properties: { a: { type: 'string' }, b: { $ref: '#/anyOf/0/properties/a' } } }],
    },
    arguments_: { b: 'hi' },
  },
  {
    label: 'a field referencing the root of a recursive schema',
    expected: 'server',
    schema: {
      type: 'object',
      anyOf: [{ properties: { a: { type: 'string' }, child: { $ref: '#' } } }],
    },
    arguments_: { child: { a: 'x' } },
  },
  {
    label: 'a field with a draft 2020-12 $dynamicRef to the root',
    expected: 'server',
    schema: {
      type: 'object',
      not: { required: ['zz'] },
      properties: { a: { type: 'string' }, child: { $dynamicRef: '#' } },
    },
    arguments_: { child: { a: 'x' } },
  },
  {
    label: 'a field with a draft 2019-09 $recursiveRef to the root',
    expected: 'server',
    schema: {
      type: 'object',
      $recursiveAnchor: true,
      anyOf: [{ properties: { a: { type: 'string' }, child: { $recursiveRef: '#' } } }],
    },
    arguments_: { child: { a: 'x' } },
  },
  {
    label: 'a $ref chained through a nested $id (root anyOf)',
    expected: 'server',
    schema: {
      anyOf: [{ $ref: '#/$defs/A' }],
      $defs: {
        A: { $id: 'urn:a', $ref: '#/$defs/B', $defs: { B: { type: 'object' } } },
        B: { type: 'object', required: ['z'] },
      },
    },
    arguments_: {},
  },
  {
    label: 'a $ref chained through a nested $id (root allOf)',
    expected: 'server',
    schema: {
      allOf: [{ $ref: '#/$defs/A' }],
      $defs: {
        A: { $id: 'urn:a', $ref: '#/$defs/B', $defs: { B: { type: 'object' } } },
        B: { type: 'object', required: ['z'] },
      },
    },
    arguments_: {},
  },
  {
    label: 'a $ref chained through a nested $id (root $ref)',
    expected: 'server',
    schema: {
      $ref: '#/$defs/A',
      $defs: {
        A: { $id: 'urn:a', $ref: '#/$defs/B', $defs: { B: { type: 'object' } } },
        B: { type: 'object', required: ['z'] },
      },
    },
    arguments_: {},
  },
  {
    label: 'a property referencing into a dropped then',
    expected: 'server',
    schema: {
      type: 'object',
      properties: { a: { $ref: '#/then/properties/b' } },
      if: { required: ['a'] },
      ...Object.fromEntries([['then', { properties: { b: { type: 'string' } } }]]),
    },
    arguments_: { a: 'x' },
  },
  {
    label: 'a non-object value for a root reference once the missing root type is set',
    expected: 'server',
    schema: { properties: { child: { $ref: '#' } } },
    arguments_: { child: 5 },
  },
  {
    label: 'a $ref inside an inlined nested $id resource',
    expected: 'server',
    schema: {
      $ref: '#/$defs/B',
      $defs: {
        B: {
          $id: 'https://x.test/b',
          type: 'object',
          allOf: [{ $ref: '#/$defs/C' }],
          $defs: { C: { required: ['c'] } },
        },
        C: { required: ['z'] },
      },
    },
    arguments_: { c: 1 },
  },
  {
    label: 'a $ref inside a nested $id alternative',
    expected: 'server',
    schema: {
      type: 'object',
      anyOf: [{ $ref: '#/$defs/B' }],
      $defs: {
        B: {
          $id: 'https://x.test/b',
          type: 'object',
          allOf: [{ $ref: '#/$defs/C' }],
          $defs: { C: { required: ['c'] } },
        },
        C: { required: ['z'] },
      },
    },
    arguments_: { c: 1 },
  },
  {
    label: 'a $ref inside an inline nested $id member',
    expected: 'server',
    schema: {
      type: 'object',
      allOf: [
        {
          $id: 'https://x.test/b',
          allOf: [{ $ref: '#/$defs/C' }],
          $defs: { C: { required: ['c'] } },
        },
      ],
      $defs: { C: { required: ['z'] } },
    },
    arguments_: { c: 1 },
  },
  {
    label: 'a call missing the root required field of a schema with a nested $id',
    expected: 'rejected',
    schema: {
      type: 'object',
      required: ['id'],
      anyOf: [{ $ref: '#/$defs/B' }],
      $defs: { B: { $id: 'urn:b', type: 'object' } },
    },
    arguments_: {},
  },
]

describe('repaired MCP direct tools with schema references', () => {
  it.each(REFERENCE_CASES)(
    'handle $label as Pi handles the server schema ($expected)',
    expectPipelineCase,
  )
})
