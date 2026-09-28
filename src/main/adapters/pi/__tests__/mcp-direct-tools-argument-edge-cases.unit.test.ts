import type { ExtensionContext } from '@earendil-works/pi-coding-agent'
import type { McpJsonValue } from '@shared/types/mcp'
import { fromPartial } from '@total-typescript/shoehorn'
import { describe, expect, it } from 'vitest'
import { isJsonSchemaObject } from '../json-schema-object'
import {
  piOnServerSchema,
  register,
  resolveLocalPointer,
  serverSchemaAccepts,
  throughRepairedTool,
} from './mcp-direct-tools-pipeline.test-utils'

describe('repaired MCP direct tools at the edges', () => {
  // Pi bundles its own TypeBox (1.3.27; the app has 1.3.32), and the copies disagree on edge
  // cases. If they converge, these premises fail: move the cases into PIPELINE_CASES.
  it('never forwards what the exact server validator rejects, even when Pi accepts it', async () => {
    // Pi's `iri` format accepts an IPvFuture host; the app's rejects it.
    const schema = {
      type: 'object',
      anyOf: [{ properties: { x: { type: 'string', format: 'iri' } }, required: ['x'] }],
    }
    const arguments_ = { x: 'http://[v1.fe]/' }

    expect(piOnServerSchema(schema, arguments_).accepted).toBe(true)
    expect(serverSchemaAccepts(schema, arguments_)).toBe(false)
    expect(await throughRepairedTool(schema, arguments_)).toEqual({ accepted: false })
  })

  it('forwards arguments as sent when only the exact server validator accepts them', async () => {
    // Pi's `minLength` counts graphemes; the app's counts code points.
    const schema = {
      type: 'object',
      anyOf: [{ properties: { s: { type: 'string', minLength: 2 } }, required: ['s'] }],
    }
    const arguments_ = { s: '🇺🇸' }

    expect(piOnServerSchema(schema, arguments_).accepted).toBe(false)
    expect(serverSchemaAccepts(schema, arguments_)).toBe(true)
    expect(await throughRepairedTool(schema, arguments_)).toEqual({
      accepted: true,
      forwarded: arguments_,
    })
  })

  it('keeps local $refs into relaxed properties resolvable', () => {
    const { definition } = register({
      type: 'object',
      properties: {
        a: { type: 'object', properties: { x: { enum: ['p', 'q'] } } },
        b: { $ref: '#/properties/a/properties/x' },
      },
      anyOf: [{ required: ['b'] }],
    })
    const parameters: unknown = JSON.parse(JSON.stringify(definition.parameters))
    const b = resolveLocalPointer(parameters, '#/properties/b/anyOf/1')
    if (!isJsonSchemaObject(b) || typeof b.$ref !== 'string') throw new Error('b was not wrapped')

    expect(resolveLocalPointer(parameters, b.$ref)).toEqual({ enum: ['p', 'q'] })
  })

  it('rebases a percent-encoded pointer but leaves references inside a nested $id resource', () => {
    const { definition } = register({
      type: 'object',
      properties: {
        'a b': { type: 'object', properties: { x: { enum: ['p'] } } },
        c: { $ref: '#/properties/a%20b/properties/x' },
        d: {
          $id: 'urn:d',
          type: 'object',
          properties: { p: { type: 'string' }, r: { $ref: '#/properties/p' } },
        },
      },
      anyOf: [{ required: ['c'] }],
    })
    const parameters: unknown = JSON.parse(JSON.stringify(definition.parameters))
    const c = resolveLocalPointer(parameters, '#/properties/c/anyOf/1')
    if (!isJsonSchemaObject(c) || typeof c.$ref !== 'string') throw new Error('c was not wrapped')

    expect(c.$ref).toBe('#/properties/a%20b/anyOf/0/properties/x')
    expect(resolveLocalPointer(parameters, c.$ref)).toEqual({ enum: ['p'] })
    expect(resolveLocalPointer(parameters, '#/properties/d/anyOf/1/properties/r')).toEqual({
      $ref: '#/properties/p',
    })
  })

  it('registers a tool whose local $ref has a malformed percent escape', () => {
    // Resolving it used to throw, which aborted registering every direct tool of the snapshot.
    const { definition } = register({ type: 'object', anyOf: [{ $ref: '#/$defs/50%' }], $defs: {} })

    expect(JSON.parse(JSON.stringify(definition.parameters))).toMatchObject({ type: 'object' })
  })

  it('rebases $refs in schemas under keyword-like names but leaves instance data alone', () => {
    const { definition } = register({
      type: 'object',
      properties: {
        a: { type: 'object', properties: { x: { type: 'string' } } },
        enum: { $ref: '#/properties/a/properties/x' },
        b: { type: 'object', const: { $ref: '#/properties/a' } },
      },
      anyOf: [{ required: ['a'] }],
    })
    const parameters: unknown = JSON.parse(JSON.stringify(definition.parameters))

    expect(resolveLocalPointer(parameters, '#/properties/enum/anyOf/1')).toEqual({
      $ref: '#/properties/a/anyOf/0/properties/x',
    })
    expect(resolveLocalPointer(parameters, '#/properties/b/anyOf/1/const')).toEqual({
      $ref: '#/properties/a',
    })
  })

  it('tells the model a closed root is closed once the relaxation drops additionalProperties', () => {
    const { definition } = register({
      type: 'object',
      properties: { a: { type: 'string' } },
      additionalProperties: false,
      anyOf: [{ required: ['a'] }],
    })
    const parameters = JSON.parse(JSON.stringify(definition.parameters))

    expect(parameters.additionalProperties).toBeUndefined()
    expect(parameters.description).toMatch(/Only the listed properties are accepted\./)
  })

  it.each<{ readonly label: string; readonly schema: McpJsonValue }>([
    {
      label: 'the root',
      schema: {
        type: 'object',
        properties: { a: { type: 'string' } },
        patternProperties: { '^x_': { type: 'string' } },
        additionalProperties: false,
        anyOf: [{ required: ['a'] }],
      },
    },
    {
      label: 'an alternative',
      schema: {
        type: 'object',
        anyOf: [
          { properties: { a: { type: 'string' } }, additionalProperties: false },
          { patternProperties: { '^x_': { type: 'string' } }, additionalProperties: false },
        ],
      },
    },
  ])('does not call a root closed when $label admits pattern properties', ({ schema }) => {
    const parameters = JSON.parse(JSON.stringify(register(schema).definition.parameters))

    expect(String(parameters.description ?? '')).not.toMatch(/Only the listed properties/)
  })

  it('rejects with a readable error when the server schema recurses without end', async () => {
    const { definition, executeGateway } = register({
      type: 'object',
      anyOf: [{ $ref: '#' }, { properties: { a: { type: 'string' } } }],
    })
    const ctx = fromPartial<ExtensionContext>({ hasUI: true, ui: { confirm: async () => true } })

    await expect(
      definition.execute('call-1', { a: 'x' }, undefined, undefined, ctx),
    ).rejects.toThrow(/server schema could not be evaluated/)
    expect(executeGateway).not.toHaveBeenCalled()
  })
})
