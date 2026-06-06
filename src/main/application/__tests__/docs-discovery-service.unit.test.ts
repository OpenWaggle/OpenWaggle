import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import type { OpenWaggleExtensionManifest } from '@shared/schemas/extensions'
import type { FirstPartyDocsTopicSummary } from '@shared/types/docs'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { afterEach, describe, expect, it } from 'vitest'
import type { DiscoveredExtensionPackage, ExtensionLifecycleState } from '../../extensions/types'
import { DocsBundleService } from '../../ports/docs-bundle-service'
import { ExtensionLifecycleRepository } from '../../ports/extension-lifecycle-repository'
import { ExtensionManagerService } from '../../ports/extension-manager-service'
import { listDocsDiscoveryView, resolveDocsTopic } from '../docs-discovery-service'

const GENERATED_AT = '2026-01-01T00:00:00.000Z'
const FIRST_PARTY_TOPIC = 'openwaggle:extending/openwaggle-extensions'
const PACKAGE_CONTENT_HASH = 'package-hash'
const NOW = 1_798_761_600_000

const firstPartySummary: FirstPartyDocsTopicSummary = {
  topic: FIRST_PARTY_TOPIC,
  source: 'openwaggle',
  group: 'OpenWaggle Docs',
  title: 'OpenWaggle Extensions',
  section: 'Extending',
  order: 1,
  path: '/bundle/topics/openwaggle/extending/openwaggle-extensions.md',
  bundlePath: 'topics/openwaggle/extending/openwaggle-extensions.md',
  sourcePath: 'website/src/content/docs/extending/openwaggle-extensions.md',
  aliases: ['extending/openwaggle-extensions'],
  keywords: ['extensions'],
  contentHash: 'first-party-hash',
}

let tempDir: string | null = null

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { force: true, recursive: true })
    tempDir = null
  }
})

async function makeExtensionPackage() {
  tempDir = await mkdtemp(path.join(tmpdir(), 'openwaggle-docs-test-'))
  const packagePath = path.join(tempDir, 'sample-extension')
  await mkdir(packagePath, { recursive: true })
  const docPath = path.join(packagePath, 'docs', 'extensions.md')
  await mkdir(path.dirname(docPath), { recursive: true })
  await writeFile(docPath, '# Extension Docs\n', 'utf8')

  const manifest: OpenWaggleExtensionManifest = {
    manifestVersion: 1,
    id: 'sample-extension',
    name: 'Sample Extension',
    version: '1.0.0',
    sdk: { openwaggle: OPENWAGGLE_EXTENSION.SDK_VERSION },
    sourceFiles: [],
    builtArtifacts: [],
    docs: {
      topics: [
        {
          id: 'extending/openwaggle-extensions',
          title: 'Extension Docs',
          path: 'docs/extensions.md',
          description: 'Extension-owned docs.',
          aliases: ['extension docs'],
          keywords: ['extension'],
        },
      ],
    },
  }

  return {
    id: 'sample-extension',
    scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND },
    packagePath,
    manifestPath: path.join(packagePath, OPENWAGGLE_EXTENSION.MANIFEST_FILE),
    manifest,
    buildPlan: null,
    contentHash: PACKAGE_CONTENT_HASH,
    sdkCompatibility: {
      hostVersion: OPENWAGGLE_EXTENSION.SDK_VERSION,
      requiredRange: OPENWAGGLE_EXTENSION.SDK_VERSION,
      compatible: true,
    },
    diagnostics: [],
  } satisfies DiscoveredExtensionPackage
}

function makeLifecycle(extensionPackage: DiscoveredExtensionPackage): ExtensionLifecycleState {
  return {
    extensionId: extensionPackage.id,
    scope: extensionPackage.scope,
    enabled: false,
    trusted: false,
    grantedCapabilities: [],
    contentHash: PACKAGE_CONTENT_HASH,
    packageVersion: '1.0.0',
    approvedBuildPlanHash: null,
    buildStatus: OPENWAGGLE_EXTENSION.BUILD_RUN_STATUS.NOT_RUN,
    buildLog: null,
    reloadStatus: OPENWAGGLE_EXTENSION.RELOAD_STATUS.NOT_RELOADED,
    lastReloadedAt: null,
    sdkRange: OPENWAGGLE_EXTENSION.SDK_VERSION,
    sdkCompatible: true,
    diagnostics: [],
    installedAt: NOW,
    updatedAt: NOW,
  }
}

function makeLayer(extensionPackage: DiscoveredExtensionPackage) {
  const lifecycle = makeLifecycle(extensionPackage)
  return Layer.mergeAll(
    Layer.succeed(
      DocsBundleService,
      DocsBundleService.of({
        getBundlePath: () => Effect.succeed('/bundle'),
        loadBundle: () =>
          Effect.succeed({
            bundlePath: '/bundle',
            generatedAt: GENERATED_AT,
            topics: [firstPartySummary],
          }),
        listTopics: () => Effect.succeed([firstPartySummary]),
        resolveTopic: (topic) =>
          Effect.succeed(topic === FIRST_PARTY_TOPIC ? firstPartySummary : null),
      }),
    ),
    Layer.succeed(
      ExtensionManagerService,
      ExtensionManagerService.of({
        listPackages: () => Effect.succeed([extensionPackage]),
      }),
    ),
    Layer.succeed(
      ExtensionLifecycleRepository,
      ExtensionLifecycleRepository.of({
        get: () => Effect.succeed(lifecycle),
        list: () => Effect.succeed([lifecycle]),
        upsert: () => Effect.void,
      }),
    ),
  )
}

describe('docs discovery service', () => {
  it('lists first-party docs and namespaced extension docs regardless of trust and enablement', async () => {
    const extensionPackage = await makeExtensionPackage()
    const result = await Effect.runPromise(
      listDocsDiscoveryView().pipe(Effect.provide(makeLayer(extensionPackage))),
    )

    expect(result.generatedAt).toBe(GENERATED_AT)
    expect(result.firstPartyTopics).toHaveLength(1)
    expect(result.firstPartyTopics[0]?.topic).toBe(FIRST_PARTY_TOPIC)
    expect(result.extensionTopics).toHaveLength(1)
    expect(result.extensionTopics[0]?.topic).toBe(
      'extension:sample-extension/extending/openwaggle-extensions',
    )
    expect(result.extensionTopics[0]?.provenance.trust).toBe('untrusted')
    expect(result.extensionTopics[0]?.provenance.lifecycle).toBe('disabled')
    expect(result.extensionTopics[0]?.contentHash).toMatch(/^[a-f0-9]+$/)
  })

  it('resolves only closed-union first-party topics', async () => {
    const extensionPackage = await makeExtensionPackage()
    const result = await Effect.runPromise(
      resolveDocsTopic({ topic: FIRST_PARTY_TOPIC }).pipe(
        Effect.provide(makeLayer(extensionPackage)),
      ),
    )

    expect(result?.topic).toBe(FIRST_PARTY_TOPIC)
    expect(result?.path).toBe(firstPartySummary.path)
  })
})
