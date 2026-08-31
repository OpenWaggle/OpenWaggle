import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
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
  exportOperation,
  exportManifest as manifest,
  exportRecords as records,
} from './filesystem-session-export-artifact-writer.test-support'

const OPEN_READ_NO_FOLLOW = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)

describe('filesystem Session export artifact writer', () => {
  let temporaryRoot = ''

  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-export-artifact-'))
  })

  afterEach(async () => {
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  const operation = (format: 'jsonl' | 'markdown' | 'bundle', filename: string) =>
    exportOperation(temporaryRoot, format, filename)

  it('keeps direct output hidden until atomic installation', async () => {
    const exportOperation = operation('jsonl', 'session.jsonl')
    const beforeFinalize = await Effect.runPromise(
      Effect.gen(function* () {
        const writer = yield* SessionExportArtifactWriter
        const sink = yield* writer.open(exportOperation)
        yield* sink.writeManifest(manifest)
        yield* sink.writeRecords(records)
        const visible = yield* Effect.promise(() =>
          fs
            .stat(exportOperation.destinationPath)
            .then(() => true)
            .catch(() => false),
        )
        yield* sink.finalize()
        return visible
      }).pipe(Effect.provide(FilesystemSessionExportArtifactWriterLive)),
    )

    const content = await fs.readFile(exportOperation.destinationPath, 'utf8')
    expect(beforeFinalize).toBe(false)
    expect(content).toContain('"record":"manifest"')
    expect(content).toContain('"nodeId":"node-1"')
    await expect(fs.stat(exportOperation.temporaryPath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('includes the complete snapshot and Follow-up queue contract in Markdown exports', async () => {
    const exportOperation = operation('markdown', 'session.md')

    await Effect.runPromise(
      Effect.gen(function* () {
        const writer = yield* SessionExportArtifactWriter
        const sink = yield* writer.open(exportOperation)
        yield* sink.writeManifest(manifest)
        yield* sink.writeRecords(records)
        yield* sink.finalize()
      }).pipe(Effect.provide(FilesystemSessionExportArtifactWriterLive)),
    )

    const content = await fs.readFile(exportOperation.destinationPath, 'utf8')
    expect(content).toContain('- Export schema: 1')
    expect(content).toContain('- Active branch: branch-1')
    expect(content).toContain('- Node high-water mark: 1')
    expect(content).toContain('- State revision: 2')
    expect(content).toContain('- Queue revision: 3')
    expect(content).toContain('- Active turn incomplete: no')
    expect(content).toContain('## Follow-up queue')
    expect(content).toContain('- Body scope: omitted-by-choice')
    expect(content).toContain('- Omitted bodies: 0')
  })

  it('surfaces a real filesystem cleanup failure from an opened sink', async () => {
    const exportOperation = operation('jsonl', 'cleanup-failure.jsonl')
    const sink = await Effect.runPromise(
      Effect.gen(function* () {
        const writer = yield* SessionExportArtifactWriter
        return yield* writer.open(exportOperation)
      }).pipe(Effect.provide(FilesystemSessionExportArtifactWriterLive)),
    )
    await fs.rm(exportOperation.temporaryPath, { force: true })
    await fs.mkdir(exportOperation.temporaryPath)
    await fs.writeFile(path.join(exportOperation.temporaryPath, 'retained'), 'data')

    await expect(Effect.runPromise(sink.discard())).rejects.toThrow('Path is a directory')
  })

  it('installs a scoped artifact from app-owned staging through its open descriptor', async () => {
    if (process.platform === 'win32') return
    const lexicalWorkspace = path.join(temporaryRoot, 'scoped-workspace')
    await fs.mkdir(lexicalWorkspace)
    const workspace = await fs.realpath(lexicalWorkspace)
    const exportsDirectory = path.join(workspace, 'exports')
    await fs.mkdir(exportsDirectory)
    const destinationPath = path.join(exportsDirectory, 'session.jsonl')
    const exportOperation = {
      ...operation('jsonl', 'unused-scoped.jsonl'),
      destinationPath,
      temporaryPath: `${destinationPath}.temporary`,
      destinationRoot: workspace,
    }

    await Effect.runPromise(
      Effect.gen(function* () {
        const writer = yield* SessionExportArtifactWriter
        const sink = yield* writer.open(exportOperation)
        yield* sink.writeManifest(manifest)
        yield* sink.writeRecords(records)
        yield* sink.finalize()
      }).pipe(Effect.provide(FilesystemSessionExportArtifactWriterLive)),
    )

    await expect(fs.readFile(destinationPath, 'utf8')).resolves.toContain('"nodeId":"node-1"')
    await expect(fs.stat(exportOperation.temporaryPath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('creates a portable bundle with transcript and explicitly requested resources', async () => {
    const exportOperation = operation('bundle', 'session.zip')
    const sourcePath = path.join(temporaryRoot, 'README.md')
    await fs.writeFile(sourcePath, '# Included resource\n')
    const sourceHandle = await fs.open(sourcePath, OPEN_READ_NO_FOLLOW)

    await Effect.runPromise(
      Effect.gen(function* () {
        const writer = yield* SessionExportArtifactWriter
        const sink = yield* writer.open(exportOperation)
        yield* sink.writeManifest(manifest)
        yield* sink.writeRecords(records)
        yield* sink.writeResource({ path: 'docs/README.md', sourceHandle })
        yield* sink.finalize()
      }).pipe(Effect.provide(FilesystemSessionExportArtifactWriterLive)),
    )

    const zip = await JSZip.loadAsync(await fs.readFile(exportOperation.destinationPath))
    const transcript = await zip.file('session.jsonl')?.async('string')
    const resource = await zip.file('resources/docs/README.md')?.async('string')
    const bundleManifest = await zip.file('manifest.json')?.async('string')
    expect(transcript).toContain('"nodeId":"node-1"')
    expect(resource).toBe('# Included resource\n')
    expect(bundleManifest).toContain('"kind":"openwaggle-session-export-bundle"')
    expect(bundleManifest).toContain('"mediaType":"application/x-ndjson"')
    expect(bundleManifest).toContain('"mediaType":"text/markdown; charset=utf-8"')
    expect(bundleManifest).toContain(
      `"sha256":"${createHash('sha256')
        .update(transcript ?? '')
        .digest('hex')}"`,
    )
    expect(bundleManifest).toContain(
      `"sha256":"${createHash('sha256')
        .update(resource ?? '')
        .digest('hex')}"`,
    )
  })

  it('reads a bundled resource through the descriptor authorized by the resolver', async () => {
    const workspacePath = path.join(temporaryRoot, 'workspace')
    const sourcePath = path.join(workspacePath, 'README.md')
    const movedPath = path.join(workspacePath, 'README.original.md')
    const outsidePath = path.join(temporaryRoot, 'outside-secret.md')
    await fs.mkdir(workspacePath)
    await fs.writeFile(sourcePath, '# Authorized contents\n')
    await fs.writeFile(outsidePath, 'must not be exported\n')
    const resolved = await openFilesystemSessionExportResource({
      workspacePath,
      resourcePath: 'README.md',
    })

    // Replacing the authorized pathname after resolution must not change the bytes copied.
    await fs.rename(sourcePath, movedPath)
    await fs.symlink(outsidePath, sourcePath)
    const exportOperation = operation('bundle', 'descriptor-bound.zip')
    await Effect.runPromise(
      Effect.gen(function* () {
        const writer = yield* SessionExportArtifactWriter
        const sink = yield* writer.open(exportOperation)
        yield* sink.writeManifest(manifest)
        yield* sink.writeRecords(records)
        yield* sink.writeResource({
          path: resolved.path,
          sourceHandle: resolved.sourceHandle,
        })
        yield* sink.finalize()
      }).pipe(Effect.provide(FilesystemSessionExportArtifactWriterLive)),
    )

    const zip = await JSZip.loadAsync(await fs.readFile(exportOperation.destinationPath))
    await expect(zip.file('resources/README.md')?.async('string')).resolves.toBe(
      '# Authorized contents\n',
    )
  })

  it('rejects a symlink as a bundled resource before returning a descriptor', async () => {
    const workspacePath = path.join(temporaryRoot, 'workspace')
    const outsidePath = path.join(temporaryRoot, 'outside-secret.md')
    await fs.mkdir(workspacePath)
    await fs.writeFile(outsidePath, 'must not be exported\n')
    await fs.symlink(outsidePath, path.join(workspacePath, 'secret.md'))

    await expect(
      openFilesystemSessionExportResource({ workspacePath, resourcePath: 'secret.md' }),
    ).rejects.toThrow()
  })

  it('keeps bundle staging files anonymous until the descriptor-backed zip is complete', async () => {
    const exportOperation = operation('bundle', 'anonymous-staging.zip')
    await Effect.runPromise(
      Effect.gen(function* () {
        const writer = yield* SessionExportArtifactWriter
        const sink = yield* writer.open(exportOperation)
        yield* sink.writeManifest(manifest)
        yield* sink.writeRecords(records)
        yield* Effect.promise(() =>
          expect(
            fs.stat(`${exportOperation.temporaryPath}.staging/session.jsonl`),
          ).rejects.toMatchObject({ code: 'ENOENT' }),
        )
        yield* sink.finalize()
      }).pipe(Effect.provide(FilesystemSessionExportArtifactWriterLive)),
    )
    const zip = await JSZip.loadAsync(await fs.readFile(exportOperation.destinationPath))
    await expect(zip.file('session.jsonl')?.async('string')).resolves.toContain(
      '"record":"manifest"',
    )
  })

  it('refuses replacement unless overwrite is explicit', async () => {
    const exportOperation = operation('markdown', 'session.md')
    await fs.writeFile(exportOperation.destinationPath, 'keep me')

    await expect(
      Effect.runPromise(
        Effect.gen(function* () {
          const writer = yield* SessionExportArtifactWriter
          yield* writer.open(exportOperation)
        }).pipe(Effect.provide(FilesystemSessionExportArtifactWriterLive)),
      ),
    ).rejects.toThrow('overwrite was not requested')
    expect(await fs.readFile(exportOperation.destinationPath, 'utf8')).toBe('keep me')
  })

  it('rejects replacement of the staged artifact before installation', async () => {
    const exportOperation = operation('jsonl', 'swapped-stage.jsonl')
    const outsidePath = path.join(temporaryRoot, 'outside.txt')
    await fs.writeFile(outsidePath, 'outside contents')

    await expect(
      Effect.runPromise(
        Effect.gen(function* () {
          const writer = yield* SessionExportArtifactWriter
          const sink = yield* writer.open(exportOperation)
          yield* sink.writeManifest(manifest)
          yield* Effect.promise(async () => {
            await fs.rm(exportOperation.temporaryPath)
            await fs.symlink(outsidePath, exportOperation.temporaryPath)
          })
          yield* sink.finalize()
        }).pipe(Effect.provide(FilesystemSessionExportArtifactWriterLive)),
      ),
    ).rejects.toThrow()
    await expect(fs.stat(exportOperation.destinationPath)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await fs.readFile(outsidePath, 'utf8')).toBe('outside contents')
  })

  it('replaces a destination symlink rather than following it', async () => {
    const exportOperation = {
      ...operation('markdown', 'symlink-destination.md'),
      overwriteExisting: true,
    }
    const outsidePath = path.join(temporaryRoot, 'outside.txt')
    await fs.writeFile(outsidePath, 'keep me')
    await fs.symlink(outsidePath, exportOperation.destinationPath)

    await Effect.runPromise(
      Effect.gen(function* () {
        const writer = yield* SessionExportArtifactWriter
        const sink = yield* writer.open(exportOperation)
        yield* sink.writeManifest(manifest)
        yield* sink.finalize()
      }).pipe(Effect.provide(FilesystemSessionExportArtifactWriterLive)),
    )
    expect(await fs.readFile(outsidePath, 'utf8')).toBe('keep me')
    expect((await fs.lstat(exportOperation.destinationPath)).isSymbolicLink()).toBe(false)
  })
})
