import { safeDecodeUnknown } from '@shared/schema'
import {
  docsResolveTopicInputSchema,
  firstPartyDocTopicSchema,
  installedDocsManifestSchema,
} from '@shared/schemas/docs'
import { describe, expect, it } from 'vitest'

describe('docs schemas', () => {
  it('accepts first-party topic ids', () => {
    const result = safeDecodeUnknown(
      firstPartyDocTopicSchema,
      'openwaggle:extending/openwaggle-extensions',
    )

    expect(result.success).toBe(true)
  })

  it('rejects extension-looking topics as first-party topics', () => {
    const result = safeDecodeUnknown(docsResolveTopicInputSchema, {
      topic: 'extension:sample/openwaggle:extending/openwaggle-extensions',
    })

    expect(result.success).toBe(false)
  })

  it('accepts the generated installed docs manifest shape', () => {
    const result = safeDecodeUnknown(installedDocsManifestSchema, {
      schemaVersion: 1,
      generatedAt: '2026-01-01T00:00:00.000Z',
      readmePath: 'README.md',
      groups: [
        {
          id: 'openwaggle',
          title: 'OpenWaggle Docs',
          description: 'Docs',
        },
      ],
      topics: [
        {
          topic: 'openwaggle:extending/openwaggle-extensions',
          source: 'openwaggle',
          group: 'OpenWaggle Docs',
          title: 'OpenWaggle Extensions',
          order: 1,
          sourcePath: 'website/src/content/docs/extending/openwaggle-extensions.md',
          bundlePath: 'topics/openwaggle/extending/openwaggle-extensions.md',
          aliases: ['extending/openwaggle-extensions'],
          keywords: ['extensions'],
          contentHash: 'hash',
        },
      ],
    })

    expect(result.success).toBe(true)
  })
})
