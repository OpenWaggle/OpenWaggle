import type { ExtensionPackageScopeView } from './extensions'

export type FirstPartyDocSource = 'openwaggle' | 'pi'
export type FirstPartyDocTopic = string
export type ExtensionDocsTrustState = 'trusted' | 'untrusted' | 'unknown'
export type ExtensionDocsLifecycleState = 'enabled' | 'disabled' | 'unavailable'
export type DocsDiscoveryDiagnosticSeverity = 'warning' | 'error'

export interface DocsDiscoveryDiagnostic {
  readonly severity: DocsDiscoveryDiagnosticSeverity
  readonly code: string
  readonly message: string
  readonly path?: string
}

export interface DocsListInput {
  readonly projectPaths?: readonly string[]
  readonly includeExtensions?: boolean
}

export interface DocsResolveTopicInput {
  readonly topic: FirstPartyDocTopic
}

export interface FirstPartyDocsTopicSummary {
  readonly topic: FirstPartyDocTopic
  readonly source: FirstPartyDocSource
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

export interface ExtensionDocsProvenance {
  readonly extensionId: string
  readonly extensionName: string | null
  readonly extensionVersion: string | null
  readonly scope: ExtensionPackageScopeView
  readonly packagePath: string
  readonly manifestPath: string
  readonly path: string
  readonly packageContentHash: string | null
  readonly trust: ExtensionDocsTrustState
  readonly lifecycle: ExtensionDocsLifecycleState
}

export interface ExtensionDocsTopicSummary {
  readonly topic: string
  readonly localTopic: string
  readonly title: string
  readonly description?: string
  readonly path: string
  readonly aliases: readonly string[]
  readonly keywords: readonly string[]
  readonly contentHash: string | null
  readonly provenance: ExtensionDocsProvenance
  readonly diagnostics: readonly DocsDiscoveryDiagnostic[]
}

export interface DocsDiscoveryView {
  readonly generatedAt: string
  readonly bundlePath: string
  readonly firstPartyTopics: readonly FirstPartyDocsTopicSummary[]
  readonly extensionTopics: readonly ExtensionDocsTopicSummary[]
  readonly diagnostics: readonly DocsDiscoveryDiagnostic[]
}
