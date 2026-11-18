import { describe, expect, it } from 'vitest'
import { nativeSyntaxResources } from '../syntax-native-import'
import { SYNTAX_IMPORT_RESOURCE_KIND_LIMIT } from '../syntax-resource-import-utils'

describe('native syntax import limits', () => {
  it.each([
    ['themes', 'themes'],
    ['grammars', 'languages'],
    ['appearances', 'appearances'],
  ] as const)('rejects too many %s before normalizing entries', (_label, kind) => {
    const raw = {
      schemaVersion: 1,
      [kind]: Array.from({ length: SYNTAX_IMPORT_RESOURCE_KIND_LIMIT + 1 }, () => null),
    }

    expect(() => nativeSyntaxResources(raw, '/tmp/oversized.openwaggle.json', 'user')).toThrow(
      'declares too many resources',
    )
  })
})
