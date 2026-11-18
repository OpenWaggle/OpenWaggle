import { describe, expect, it } from 'vitest'
import {
  legacyMcpServerAliases,
  resolveLegacyMcpServerReferences,
} from '../legacy-server-references'

const LEGACY = new Map([
  ['gh-1', 'github'],
  ['old-1', 'removed'],
])

describe('old MCP instance IDs', () => {
  it('stand for their server name in an allowlist, once', () => {
    expect(resolveLegacyMcpServerReferences(['gh-1', 'github', 'lint'], LEGACY)).toEqual([
      'github',
      'lint',
    ])
  })

  it('are valid references only to servers that are still configured', () => {
    expect(legacyMcpServerAliases(['github', 'lint'], LEGACY)).toEqual(['gh-1'])
  })
})
