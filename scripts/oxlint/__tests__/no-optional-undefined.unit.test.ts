import { describe, expect, it } from 'vitest'
import { openwagglePlugin } from '../openwaggle-plugin.ts'
import { fixWithRule, lintWithRule } from './lint-rule.ts'

const RULE_NAME = 'openwaggle/no-optional-undefined'
const FILENAME = 'src/main/example.ts'

function lint(code: string) {
  return lintWithRule(openwagglePlugin, RULE_NAME, code, FILENAME)
}

function fix(code: string) {
  return fixWithRule(openwagglePlugin, RULE_NAME, code, FILENAME)
}

describe('openwaggle/no-optional-undefined', () => {
  it.each([
    [
      'an interface property',
      'interface A {\n  readonly language?: string | undefined\n}\n',
      'language',
      'interface A {\n  readonly language?: string\n}\n',
    ],
    [
      'a type literal property',
      'type A = { x?: number | undefined }\n',
      'x',
      'type A = { x?: number }\n',
    ],
    [
      'undefined first',
      'interface A {\n  x?: undefined | string\n}\n',
      'x',
      'interface A {\n  x?: string\n}\n',
    ],
    [
      'a union of three',
      'interface A {\n  x?: (() => void) | null | undefined\n}\n',
      'x',
      'interface A {\n  x?: (() => void) | null\n}\n',
    ],
    [
      'a multi-line union',
      'interface A {\n  x?:\n    | { a: 1 }\n    | undefined\n}\n',
      'x',
      'interface A {\n  x?:\n    | { a: 1 }\n}\n',
    ],
    [
      'a class property',
      'class A {\n  x?: string | undefined\n}\n',
      'x',
      'class A {\n  x?: string\n}\n',
    ],
  ])('reports and fixes %s', (_label, code, name, fixed) => {
    expect(lint(code)).toEqual([
      expect.objectContaining({ ruleId: RULE_NAME, message: expect.stringContaining(`'${name}'`) }),
    ])
    expect(fix(code)).toBe(fixed)
  })

  it.each([
    ['an exact optional property', 'interface A {\n  x?: string\n}\n'],
    ['a required property that may be undefined', 'interface A {\n  x: string | undefined\n}\n'],
    [
      'an undefined inside an element type',
      'interface A {\n  x?: readonly (string | undefined)[]\n}\n',
    ],
    ['an optional parameter', 'function f(x?: string | undefined) {\n  return x\n}\n'],
    [
      'a property whose comment says why',
      'interface A {\n  // explicit undefined: Node declares pid so.\n  readonly pid?: number | undefined\n}\n',
    ],
    [
      'a property after a marked one in a chain of comments',
      'interface A {\n  /** The pid. */\n  // Explicit undefined: Node declares it so.\n  pid?: number | undefined\n}\n',
    ],
    [
      'a type declaration whose comment says why',
      '// explicit undefined: mirrors the mdast types.\nexport interface Node {\n  value?: string | undefined\n}\n',
    ],
  ])('allows %s', (_label, code) => {
    expect(lint(code)).toEqual([])
  })

  it('reports a property whose comment gives no reason', () => {
    expect(lint('interface A {\n  /** The pid. */\n  pid?: number | undefined\n}\n')).toHaveLength(
      1,
    )
  })
})
