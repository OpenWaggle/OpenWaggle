import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as Effect from 'effect/Effect'
import JSZip from 'jszip'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SessionExportArtifactWriter } from '../../ports/session-export-artifact-writer'
import { FilesystemSessionExportArtifactWriterLive } from '../filesystem-session-export-artifact-writer'
import { openFilesystemSessionExportResource } from '../filesystem-session-export-resource-resolver'
import {
  exportManifest,
  exportOperation,
  exportRecords,
} from './filesystem-session-export-artifact-writer.test-support'

describe('filesystem Session export resource copy', () => {
  let temporaryRoot = ''

  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-export-resource-'))
  })

  afterEach(async () => {
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  async function writeResolvedResource(input: {
    readonly destinationName: string
    readonly resolved: Awaited<ReturnType<typeof openFilesystemSessionExportResource>>
  }) {
    const operation = exportOperation(temporaryRoot, 'bundle', input.destinationName)
    await Effect.runPromise(
      Effect.gen(function* () {
        const writer = yield* SessionExportArtifactWriter
        const sink = yield* writer.open(operation)
        yield* sink.writeManifest(exportManifest)
        yield* sink.writeRecords(exportRecords)
        yield* sink.writeResource({
          path: input.resolved.path,
          sourceHandle: input.resolved.sourceHandle,
          expectedSize: input.resolved.size,
          expectedIdentity: input.resolved.identity,
        })
        yield* sink.finalize()
      }).pipe(Effect.provide(FilesystemSessionExportArtifactWriterLive)),
    )
    return operation.destinationPath
  }

  it('copies through the descriptor authorized by the resolver', async () => {
    const workspacePath = path.join(temporaryRoot, 'workspace')
    const sourcePath = path.join(workspacePath, 'README.md')
    const outsidePath = path.join(temporaryRoot, 'outside-secret.md')
    await fs.mkdir(workspacePath)
    await fs.writeFile(sourcePath, '# Authorized contents\n')
    await fs.writeFile(outsidePath, 'must not be exported\n')
    const resolved = await openFilesystemSessionExportResource({
      workspacePath,
      resourcePath: 'README.md',
    })

    await fs.rename(sourcePath, path.join(workspacePath, 'README.original.md'))
    await fs.symlink(outsidePath, sourcePath)
    const destination = await writeResolvedResource({
      destinationName: 'descriptor-bound.zip',
      resolved,
    })

    const zip = await JSZip.loadAsync(await fs.readFile(destination))
    await expect(zip.file('resources/README.md')?.async('string')).resolves.toBe(
      '# Authorized contents\n',
    )
  })

  it('rejects a resource that grows after descriptor authorization', async () => {
    const workspacePath = path.join(temporaryRoot, 'growing-workspace')
    const sourcePath = path.join(workspacePath, 'growing.txt')
    await fs.mkdir(workspacePath)
    await fs.writeFile(sourcePath, 'authorized')
    const resolved = await openFilesystemSessionExportResource({
      workspacePath,
      resourcePath: 'growing.txt',
    })
    await fs.appendFile(sourcePath, ' appended after authorization')

    await expect(
      writeResolvedResource({ destinationName: 'growing.zip', resolved }),
    ).rejects.toThrow('changed after its descriptor was authorized')
  })
})
