// Generated from src/internal/type-sources/docs.ts by scripts/generate-extension-sdk-types.ts;
// do not edit. Regenerate with `bun run extension-sdk-types:generate`; the
// `extension-sdk-types` check step fails when this file no longer matches the schemas.

export type ExtensionDocsDiscoverPayload = {
  readonly projectPaths?: readonly string[]
  readonly includeExtensions?: boolean
}

export type ExtensionDocsResolveTopicPayload = { readonly topic: string }

export type ExtensionDocsDiscoverResult = {
  readonly extensionId: string
  readonly contributionId: string
  readonly capability: 'openwaggle.docs'
  readonly method: 'discover-docs'
  readonly docs: ExtensionDocsDiscoveryView
}

export type ExtensionDocsResolveTopicResult = {
  readonly extensionId: string
  readonly contributionId: string
  readonly capability: 'openwaggle.docs'
  readonly method: 'resolve-docs-topic'
  readonly resolvedTopic: FirstPartyDocsTopicSummary | null
}

export type ExtensionDocsDiscoveryView = {
  readonly generatedAt: string
  readonly bundlePath: string
  readonly firstPartyTopics: readonly FirstPartyDocsTopicSummary[]
  readonly extensionTopics: readonly {
    readonly topic: string
    readonly localTopic: string
    readonly title: string
    readonly description?: string
    readonly path: string
    readonly aliases: readonly string[]
    readonly keywords: readonly string[]
    readonly contentHash: string | null
    readonly provenance: {
      readonly extensionId: string
      readonly extensionName: string | null
      readonly extensionVersion: string | null
      readonly scope: {
        readonly kind: 'global' | 'project'
        readonly label: string
        readonly projectPath?: string
      }
      readonly packagePath: string
      readonly manifestPath: string
      readonly path: string
      readonly packageContentHash: string | null
      readonly trust: 'trusted' | 'unknown' | 'untrusted'
      readonly lifecycle: 'disabled' | 'enabled' | 'unavailable'
    }
    readonly diagnostics: readonly {
      readonly severity: 'error' | 'warning'
      readonly code: string
      readonly message: string
      readonly path?: string
    }[]
  }[]
  readonly diagnostics: readonly {
    readonly severity: 'error' | 'warning'
    readonly code: string
    readonly message: string
    readonly path?: string
  }[]
}

export type FirstPartyDocsTopicSummary = {
  readonly topic: string
  readonly source: 'openwaggle' | 'pi'
  readonly group: string
  readonly title: string
  readonly description?: string
  readonly section?: string
  readonly order: number
  readonly path: string
  readonly bundlePath: string
  readonly sourcePath: string
  readonly aliases: readonly string[]
  readonly keywords: readonly string[]
  readonly contentHash: string
}
