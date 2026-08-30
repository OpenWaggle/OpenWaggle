import { type FileHandle, mkdir, rm, unlink } from 'node:fs/promises'
import path from 'node:path'
import type { SessionExportManifest } from '@shared/types/session-export'
import { Layer } from 'effect'
import * as Effect from 'effect/Effect'
import {
  type SessionExportArtifactSink,
  SessionExportArtifactWriter,
} from '../ports/session-export-artifact-writer'
import type { SessionExportOperationRecord } from '../ports/session-export-operation-repository'
import { isPathInsideDirectory } from '../utils/project-path-validation'
import {
  assertOperationPathScope,
  copyFileHandles,
  digestFileHandle,
  installExportArtifact,
  normalizeResourcePath,
  openNewExportArtifact,
  openUnlinkedScopedExportFile,
  pathExists,
  sessionExportArtifactError,
  verifyInstalledExportArtifact,
} from './filesystem-session-export-artifact-support'
import {
  discardOperationArtifacts,
  prepareExportWorkingPaths,
} from './filesystem-session-export-working-paths'
import { serializeExportManifest, serializeExportRecords } from './session-export-artifact-format'
import {
  finalizeSessionExportBundle,
  type SessionExportBundleSource,
} from './session-export-bundle'

const OWNER_DIRECTORY_MODE = 0o700

class FilesystemSessionExportArtifactSink implements SessionExportArtifactSink {
  private closed = false
  private exportManifest: SessionExportManifest | null = null
  private prepared: {
    readonly receipt: { readonly sha256: string; readonly sizeBytes: number }
    readonly expectedArtifact: { readonly dev: number | bigint; readonly ino: number | bigint }
  } | null = null

  constructor(
    private readonly operation: SessionExportOperationRecord,
    private readonly transcriptHandle: FileHandle,
    private readonly stagingPath: string | null,
    private readonly bundleHandle: FileHandle | null,
    private readonly bundleSources: SessionExportBundleSource[],
  ) {}

  private async closeHandles() {
    const handles = this.bundleHandle
      ? [this.bundleHandle, ...this.bundleSources.map((source) => source.handle)]
      : [this.transcriptHandle]
    await Promise.all(handles.map((handle) => handle.close().catch(() => undefined)))
  }

  private writeText(text: string) {
    return Effect.tryPromise({
      try: async () => {
        if (this.closed) throw new Error('Export artifact is already closed.')
        await this.transcriptHandle.write(text)
        return Buffer.byteLength(text, 'utf8')
      },
      catch: (cause) => sessionExportArtifactError('write-export-artifact', cause),
    })
  }

  writeManifest = (manifest: Parameters<SessionExportArtifactSink['writeManifest']>[0]) => {
    this.exportManifest = manifest
    return this.writeText(
      serializeExportManifest(
        this.operation.format === 'bundle' ? 'jsonl' : this.operation.format,
        manifest,
      ),
    )
  }

  writeRecords = (records: Parameters<SessionExportArtifactSink['writeRecords']>[0]) =>
    this.writeText(
      serializeExportRecords(
        this.operation.format === 'bundle' ? 'jsonl' : this.operation.format,
        records,
      ),
    )

  writeResource = (input: Parameters<SessionExportArtifactSink['writeResource']>[0]) =>
    Effect.tryPromise({
      try: async () => {
        try {
          if (!this.stagingPath) throw new Error('Resources require the bundle export format.')
          const relativePath = normalizeResourcePath(input.path)
          if (this.operation.destinationRoot) {
            const destinationHandle = await openUnlinkedScopedExportFile('resource')
            let retained = false
            try {
              const bytesWritten = await copyFileHandles(input.sourceHandle, destinationHandle)
              await destinationHandle.sync()
              const size = (await destinationHandle.stat()).size
              if (size !== bytesWritten)
                throw new Error('Export resource size changed while copying.')
              this.bundleSources.push({
                path: `resources/${relativePath}`,
                handle: destinationHandle,
              })
              retained = true
              return size
            } finally {
              if (!retained) await destinationHandle.close().catch(() => undefined)
            }
          }
          const resourcesRoot = path.join(this.stagingPath, 'resources')
          const destination = path.resolve(resourcesRoot, relativePath)
          if (!isPathInsideDirectory(resourcesRoot, destination)) {
            throw new Error('Export resource path cannot leave the bundle.')
          }
          await mkdir(path.dirname(destination), { recursive: true, mode: OWNER_DIRECTORY_MODE })
          const destinationHandle = await openNewExportArtifact(destination)
          let retained = false
          try {
            const bytesWritten = await copyFileHandles(input.sourceHandle, destinationHandle)
            await destinationHandle.sync()
            const size = (await destinationHandle.stat()).size
            if (size !== bytesWritten)
              throw new Error('Export resource size changed while copying.')
            await unlink(destination)
            this.bundleSources.push({
              path: `resources/${relativePath}`,
              handle: destinationHandle,
            })
            retained = true
            return size
          } finally {
            if (!retained) await destinationHandle.close().catch(() => undefined)
          }
        } finally {
          await input.sourceHandle.close().catch(() => undefined)
        }
      },
      catch: (cause) => sessionExportArtifactError('write-export-resource', cause),
    })

  prepareFinalization = () =>
    Effect.tryPromise({
      try: async () => {
        if (this.prepared) return this.prepared.receipt
        if (this.closed) throw new Error('Export artifact is already closed.')
        this.closed = true
        await this.transcriptHandle.sync()
        if (this.stagingPath) {
          if (!this.exportManifest) throw new Error('Bundle export manifest was not written.')
          if (!this.bundleHandle) throw new Error('Bundle export destination is not open.')
          await finalizeSessionExportBundle({
            sources: this.bundleSources,
            destinationHandle: this.bundleHandle,
            exportManifest: this.exportManifest,
          })
        }
        const expectedArtifact = await (this.bundleHandle ?? this.transcriptHandle).stat({
          bigint: true,
        })
        const artifactHandle = this.bundleHandle ?? this.transcriptHandle
        const receipt = {
          sha256: await digestFileHandle(artifactHandle),
          sizeBytes: Number(expectedArtifact.size),
        }
        this.prepared = { receipt, expectedArtifact }
        return receipt
      },
      catch: (cause) => sessionExportArtifactError('prepare-export-artifact-finalization', cause),
    })

  finalize = () =>
    Effect.tryPromise({
      try: async () => {
        if (!this.prepared) await Effect.runPromise(this.prepareFinalization())
        const prepared = this.prepared
        if (!prepared) throw new Error('Export artifact finalization was not prepared.')
        if (this.operation.destinationRoot) {
          const sourceHandle = this.bundleHandle ?? this.transcriptHandle
          const installSource = await openUnlinkedScopedExportFile('install')
          try {
            await copyFileHandles(sourceHandle, installSource)
            await installSource.sync()
            const installArtifact = await installSource.stat({ bigint: true })
            await installExportArtifact(this.operation, installArtifact, installSource)
            return
          } finally {
            await installSource.close().catch(() => undefined)
            await this.closeHandles()
          }
        } else {
          await this.closeHandles()
          await installExportArtifact(this.operation, prepared.expectedArtifact)
        }
        if (this.stagingPath) {
          await assertOperationPathScope(this.operation, this.stagingPath)
          await rm(this.stagingPath, { recursive: true, force: true })
        }
      },
      catch: (cause) => sessionExportArtifactError('finalize-export-artifact', cause),
    })

  discard = () =>
    Effect.tryPromise({
      try: async () => {
        this.closed = true
        await this.closeHandles()
        if (this.operation.destinationRoot) return
        await assertOperationPathScope(this.operation, this.operation.temporaryPath)
        await rm(this.operation.temporaryPath, { force: true })
        const stagingPath = this.stagingPath
        if (stagingPath) {
          await assertOperationPathScope(this.operation, stagingPath)
          await rm(stagingPath, { recursive: true, force: true })
        }
      },
      catch: (cause) => sessionExportArtifactError('discard-export-artifact', cause),
    })
}

async function openSink(operation: SessionExportOperationRecord) {
  if (!path.isAbsolute(operation.destinationPath)) {
    throw new Error('Export destination path must be absolute.')
  }
  await assertOperationPathScope(operation, operation.destinationPath)
  if (!operation.overwriteExisting && (await pathExists(operation.destinationPath))) {
    throw new Error('Export destination already exists; overwrite was not requested.')
  }
  if (operation.destinationRoot) {
    const transcriptHandle = await openUnlinkedScopedExportFile('transcript')
    if (operation.format !== 'bundle') {
      return new FilesystemSessionExportArtifactSink(operation, transcriptHandle, null, null, [])
    }
    try {
      const bundleHandle = await openUnlinkedScopedExportFile('bundle')
      return new FilesystemSessionExportArtifactSink(
        operation,
        transcriptHandle,
        'unlinked-scoped-bundle',
        bundleHandle,
        [{ path: 'session.jsonl', handle: transcriptHandle }],
      )
    } catch (error) {
      await transcriptHandle.close().catch(() => undefined)
      throw error
    }
  }
  const { artifactPath, stagingPath } = await prepareExportWorkingPaths(operation)
  const transcriptPath = stagingPath ? path.join(stagingPath, 'session.jsonl') : artifactPath
  const transcriptHandle = await openNewExportArtifact(transcriptPath)
  if (!stagingPath) {
    return new FilesystemSessionExportArtifactSink(operation, transcriptHandle, null, null, [])
  }
  try {
    await unlink(transcriptPath)
    const bundleHandle = await openNewExportArtifact(artifactPath)
    return new FilesystemSessionExportArtifactSink(
      operation,
      transcriptHandle,
      stagingPath,
      bundleHandle,
      [{ path: 'session.jsonl', handle: transcriptHandle }],
    )
  } catch (error) {
    await transcriptHandle.close().catch(() => undefined)
    throw error
  }
}

export const FilesystemSessionExportArtifactWriterLive = Layer.succeed(
  SessionExportArtifactWriter,
  SessionExportArtifactWriter.of({
    open: (operation) =>
      Effect.tryPromise({
        try: () => openSink(operation),
        catch: (cause) => sessionExportArtifactError('open-export-artifact', cause),
      }),
    discard: (operation) =>
      Effect.tryPromise({
        try: () => discardOperationArtifacts(operation),
        catch: (cause) => sessionExportArtifactError('discard-export-artifact', cause),
      }),
    verifyInstalled: (operation, receipt) =>
      Effect.tryPromise({
        try: () => verifyInstalledExportArtifact(operation, receipt),
        catch: (cause) => sessionExportArtifactError('verify-installed-export-artifact', cause),
      }),
  }),
)
