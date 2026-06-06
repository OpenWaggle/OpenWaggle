import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { safeDecodeUnknown } from '@shared/schema'
import { installedDocsManifestSchema } from '@shared/schemas/docs'
import type { FirstPartyDocTopic } from '@shared/types/docs'
import { Layer } from 'effect'
import * as Effect from 'effect/Effect'
import { app } from 'electron'
import { DocsBundleError } from '../errors'
import { DocsBundleService, type LoadedDocsBundle } from '../ports/docs-bundle-service'

const INSTALLED_DOCS_DIR = 'openwaggle-docs'
const INSTALLED_DOCS_INDEX = 'index.json'

function getBundleRootPath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, INSTALLED_DOCS_DIR)
  }

  return path.resolve(process.cwd(), 'build', INSTALLED_DOCS_DIR)
}

async function loadBundle(): Promise<LoadedDocsBundle> {
  const bundlePath = getBundleRootPath()
  const rawManifest = await readFile(path.join(bundlePath, INSTALLED_DOCS_INDEX), 'utf8')
  const parsed: unknown = JSON.parse(rawManifest)
  const decoded = safeDecodeUnknown(installedDocsManifestSchema, parsed)
  if (!decoded.success) {
    throw new Error(decoded.issues.join('; '))
  }

  return {
    bundlePath,
    generatedAt: decoded.data.generatedAt,
    topics: decoded.data.topics.map((topic) => ({
      topic: topic.topic,
      source: topic.source,
      group: topic.group,
      title: topic.title,
      ...(topic.description !== undefined ? { description: topic.description } : {}),
      ...(topic.section !== undefined ? { section: topic.section } : {}),
      order: topic.order,
      path: path.join(bundlePath, topic.bundlePath),
      bundlePath: topic.bundlePath,
      sourcePath: topic.sourcePath,
      aliases: topic.aliases,
      keywords: topic.keywords,
      contentHash: topic.contentHash,
    })),
  }
}

function docsBundleError(operation: string) {
  return (cause: unknown) => new DocsBundleError({ operation, cause })
}

export const FilesystemDocsBundleLive = Layer.succeed(
  DocsBundleService,
  DocsBundleService.of({
    getBundlePath: () => Effect.succeed(getBundleRootPath()),
    loadBundle: () =>
      Effect.tryPromise({
        try: loadBundle,
        catch: docsBundleError('load-installed-docs'),
      }),
    listTopics: () =>
      Effect.tryPromise({
        try: async () => (await loadBundle()).topics,
        catch: docsBundleError('list-installed-docs'),
      }),
    resolveTopic: (topic: FirstPartyDocTopic) =>
      Effect.tryPromise({
        try: async () => {
          const topics = (await loadBundle()).topics
          return topics.find((candidate) => candidate.topic === topic) ?? null
        },
        catch: docsBundleError('resolve-installed-doc-topic'),
      }),
  }),
)
