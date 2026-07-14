import type { DocsDiscoveryView, DocsListInput, DocsResolveTopicInput } from '@shared/types/docs'
import * as Effect from 'effect/Effect'
import { DocsBundleService } from '../ports/docs-bundle-service'
import { listExtensionDocs } from './extension-docs-discovery-service'

export function listDocsDiscoveryView(input: DocsListInput = {}) {
  return Effect.gen(function* () {
    const docsBundle = yield* DocsBundleService
    const bundle = yield* docsBundle.loadBundle()
    const extensionDocs = yield* listExtensionDocs(input)

    return {
      generatedAt: bundle.generatedAt,
      bundlePath: bundle.bundlePath,
      firstPartyTopics: bundle.topics,
      extensionTopics: extensionDocs.topics,
      diagnostics: extensionDocs.diagnostics,
    } satisfies DocsDiscoveryView
  })
}

export function resolveDocsTopic(input: DocsResolveTopicInput) {
  return Effect.gen(function* () {
    const docsBundle = yield* DocsBundleService
    return yield* docsBundle.resolveTopic(input.topic)
  })
}
