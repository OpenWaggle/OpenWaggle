import { constants } from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as Effect from 'effect/Effect'
import JSZip from 'jszip'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SessionExportArtifactWriter } from '../../ports/session-export-artifact-writer'
import { FilesystemSessionExportArtifactWriterLive } from '../filesystem-session-export-artifact-writer'
import { finalizeSessionExportBundle } from '../session-export-bundle'
import {
  exportOperation,
  exportManifest as manifest,
  exportRecords as records,
} from './filesystem-session-export-artifact-writer.test-support'

const OPEN_READ_NO_FOLLOW = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)

describe('Session export bundle duplicate paths', () => {
  let root: string

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-bundle-duplicates-'))
  })

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true })
  })

  it('rejects duplicate normalized resource paths before they enter a bundle manifest', async () => {
    const operation = exportOperation(root, 'bundle', 'duplicate-resources.zip')
    const sourcePath = path.join(root, 'resource.md')
    await fs.writeFile(sourcePath, '# Resource\n')
    const sink = await Effect.runPromise(
      Effect.gen(function* () {
        const writer = yield* SessionExportArtifactWriter
        const opened = yield* writer.open(operation)
        yield* opened.writeManifest(manifest)
        yield* opened.writeRecords(records)
        return opened
      }).pipe(Effect.provide(FilesystemSessionExportArtifactWriterLive)),
    )
    let finalized = false
    try {
      const firstHandle = await fs.open(sourcePath, OPEN_READ_NO_FOLLOW)
      const firstStats = await firstHandle.stat()
      await Effect.runPromise(
        sink.writeResource({
          path: './docs/resource.md',
          sourceHandle: firstHandle,
          expectedSize: firstStats.size,
          expectedIdentity: { dev: firstStats.dev, ino: firstStats.ino },
        }),
      )
      const duplicateHandle = await fs.open(sourcePath, OPEN_READ_NO_FOLLOW)
      const duplicateStats = await duplicateHandle.stat()
      await expect(
        Effect.runPromise(
          sink.writeResource({
            path: 'docs/resource.md',
            sourceHandle: duplicateHandle,
            expectedSize: duplicateStats.size,
            expectedIdentity: { dev: duplicateStats.dev, ino: duplicateStats.ino },
          }),
        ),
      ).rejects.toThrow('Duplicate export resource path')

      await Effect.runPromise(sink.finalize())
      finalized = true
      const zip = await JSZip.loadAsync(await fs.readFile(operation.destinationPath))
      const bundleManifest = JSON.parse((await zip.file('manifest.json')?.async('string')) ?? '')
      expect(bundleManifest.entries.map((entry: { path: string }) => entry.path)).toEqual([
        'resources/docs/resource.md',
        'session.jsonl',
      ])
    } finally {
      if (!finalized) await Effect.runPromise(sink.discard())
    }
  })

  it('rejects duplicate bundle source names when finalization is called directly', async () => {
    const transcriptPath = path.join(root, 'duplicate-transcript.jsonl')
    const resourcePath = path.join(root, 'duplicate-resource.md')
    const destinationPath = path.join(root, 'duplicate-direct-bundle.zip')
    await fs.writeFile(transcriptPath, '{"record":"manifest"}\n')
    await fs.writeFile(resourcePath, '# Resource\n')
    const transcriptHandle = await fs.open(transcriptPath, 'r')
    const resourceHandle = await fs.open(resourcePath, 'r')
    const destinationHandle = await fs.open(destinationPath, 'w+')
    try {
      await expect(
        finalizeSessionExportBundle({
          sources: [
            { path: 'session.jsonl', handle: transcriptHandle },
            { path: 'resources/a.md', handle: resourceHandle },
            { path: 'resources/a.md', handle: resourceHandle },
          ],
          destinationHandle,
          exportManifest: manifest,
        }),
      ).rejects.toThrow('Duplicate bundle entry path')
    } finally {
      await Promise.all([
        transcriptHandle.close(),
        resourceHandle.close(),
        destinationHandle.close(),
      ])
    }
  })
})
