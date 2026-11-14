import { describe, expect, it } from 'vitest'
import { namedGroups } from '../regex-named-groups'

const VERSION = /^(?<major>\d+)\.(?<minor>\d+)(?:-(?<tag>\w+))?$/u

describe('namedGroups', () => {
  it.each([
    ['every declared group', '1.2-beta', { major: '1', minor: '2', tag: 'beta' }],
    ['a group that did not take part', '1.2', { major: '1', minor: '2' }],
    ['no match', 'v1', null],
  ])('returns %s', (_name, text, expected) => {
    expect(namedGroups(VERSION.exec(text), ['major', 'minor', 'tag'])).toStrictEqual(expected)
  })

  it('returns null for a pattern without groups and leaves undeclared names out', () => {
    expect(namedGroups(/^\d+$/u.exec('12'), ['digits'])).toBeNull()
    expect(namedGroups(VERSION.exec('3.4-rc'), ['major'])).toStrictEqual({ major: '3' })
  })
})
