import { Type } from 'typebox'
import { Check } from 'typebox/value'
import { describe, expect, it } from 'vitest'
import { literalUnionsAsEnums } from '../tool-schema-enums'

function json(schema: unknown) {
  const plain: unknown = JSON.parse(JSON.stringify(schema))
  if (typeof plain !== 'object' || plain === null || Array.isArray(plain)) throw new Error('object')
  return Object.fromEntries(Object.entries(plain))
}

describe('literalUnionsAsEnums', () => {
  it('writes a string literal union as one enum that accepts the same values', () => {
    const schema = Type.Object({
      mode: Type.Union([Type.Literal('fill'), Type.Literal('preset')], { description: 'How.' }),
    })
    const compact = literalUnionsAsEnums(json(schema))

    expect(compact).toEqual({
      type: 'object',
      required: ['mode'],
      properties: { mode: { type: 'string', enum: ['fill', 'preset'], description: 'How.' } },
    })
    expect(Check(compact, { mode: 'preset' })).toBe(true)
    expect(Check(compact, { mode: 'other' })).toBe(false)
  })

  it('merges unions of enums and keeps unions with other members', () => {
    const compact = literalUnionsAsEnums({
      properties: {
        workspace: { anyOf: [{ enum: ['a', 'b'] }, { type: 'string', const: 'c' }] },
        provider: { anyOf: [{ const: 'github' }, { type: 'null' }] },
      },
    })

    expect(compact).toEqual({
      properties: {
        workspace: { type: 'string', enum: ['a', 'b', 'c'] },
        provider: { anyOf: [{ const: 'github' }, { type: 'null' }] },
      },
    })
  })
})
