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
})
