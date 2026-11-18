import { describe, expect, it } from 'vitest'
import { openwagglePlugin } from '../openwaggle-plugin.ts'
import { fixWithRule, lintWithRule } from './lint-rule.ts'

const RULE_NAME = 'openwaggle/no-literal-key-lookup'
const FILENAME = 'src/main/example.ts'

function lint(code: string) {
  return lintWithRule(openwagglePlugin, RULE_NAME, code, FILENAME)
}

function fix(code: string) {
  return fixWithRule(openwagglePlugin, RULE_NAME, code, FILENAME)
}

describe('openwaggle/no-literal-key-lookup', () => {
  it.each([
    ['a computed read', "const kind = value['kind']\n", 'kind', 'const kind = value.kind\n'],
    [
      'an optional computed read',
      "const kind = value?.['kind']\n",
      'kind',
      'const kind = value?.kind\n',
    ],
    [
      'a chained read',
      "const id = payload.session['id']\n",
      'id',
      'const id = payload.session.id\n',
    ],
    ['a write', "record['count'] = 1\n", 'count', 'record.count = 1\n'],
    ['a delete', "delete settings['legacy']\n", 'legacy', 'delete settings.legacy\n'],
    [
      'a double-quoted key',
      'const env = process.env["HOME"]\n',
      'HOME',
      'const env = process.env.HOME\n',
    ],
    [
      'a template key without expressions',
      'const name = groups[`name`]\n',
      'name',
      'const name = groups.name\n',
    ],
    [
      'a reserved word',
      "const fallback = module['default']\n",
      'default',
      'const fallback = module.default\n',
    ],
    [
      'a parenthesized object',
      "const kind = (value as Entry)['kind']\n",
      'kind',
      'const kind = (value as Entry).kind\n',
    ],
    ['a call result', "const first = read()['items']\n", 'items', 'const first = read().items\n'],
  ])('reports and fixes %s', (_name, code, key, fixed) => {
    const messages = lint(code)
    expect(messages).toHaveLength(1)
    expect(messages.at(0)?.ruleId).toBe(RULE_NAME)
    expect(messages.at(0)?.message).toContain(`'${key}'`)
    expect(fix(code)).toBe(fixed)
  })

  it('fixes nested reads in one pass', () => {
    expect(fix("const id = event['payload']?.['session']['id']\n")).toBe(
      'const id = event.payload?.session.id\n',
    )
  })

  it.each([
    ['dot access', 'const kind = value.kind\n'],
    ['a variable key', 'const header = headers[name]\n'],
    [
      'a key that is not an identifier',
      "const type = headers['content-type']\nconst first = list['0']\n",
    ],
    ['a numeric index', 'const first = list[0]\n'],
    ['a template key with an expression', 'const item = map[`${prefix}id`]\n'],
    ['type-level indexed access', "type Parts = Message['parts']\nlet api: Api['read']\n"],
    ['an `in` check', "const has = 'kind' in value\n"],
    ['an object literal with a computed key', "const value = { ['kind']: 1 }\n"],
  ])('allows %s', (_name, code) => {
    expect(lint(code)).toEqual([])
  })
})
