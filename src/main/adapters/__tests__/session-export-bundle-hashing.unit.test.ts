import type { FileHandle } from 'node:fs/promises'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fromPartial } from '@total-typescript/shoehorn'
import JSZip from 'jszip'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { finalizeSessionExportBundle } from '../session-export-bundle'
import { exportManifest } from './filesystem-session-export-artifact-writer.test-support'

const RESOURCE_COUNT = 10

/** An in-memory source whose reads stay in flight for a moment, counted across every source. */
function memorySource(
  filePath: string,
  contents: string,
  reads: { inFlight: number; most: number },
) {
  const bytes = Buffer.from(contents)
  const handle = fromPartial<FileHandle>({
    stat: async () => fromPartial({ size: bytes.length }),
    read: async (buffer: Buffer, offset: number, length: number, position: number) => {
      reads.inFlight += 1
      reads.most = Math.max(reads.most, reads.inFlight)
      await new Promise((resolve) => setTimeout(resolve, 5))
      const bytesRead = bytes.copy(buffer, offset, position, position + length)
      reads.inFlight -= 1
      return { bytesRead, buffer }
    },
  })
  return { path: filePath, handle }
}

describe('finalizeSessionExportBundle hashing', () => {
  let root: string

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-bundle-hashing-'))
  })

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true })
  })

  // Regression: every source was hashed at once, each holding a 1 MiB read buffer.
  it('hashes at most four sources at once and lists them in path order', async () => {
    const reads = { inFlight: 0, most: 0 }
    const resources = Array.from({ length: RESOURCE_COUNT }, (_, index) =>
      memorySource(`resources/${String(index).padStart(2, '0')}.md`, `# ${index}\n`, reads),
    )
    const transcript = memorySource('session.jsonl', '{"record":"manifest"}\n', {
      inFlight: 0,
      most: 0,
    })
    const destinationPath = path.join(root, 'bundle.zip')
    const destination = await fs.open(destinationPath, 'w')
    try {
      await finalizeSessionExportBundle({
        sources: [...resources].reverse().concat(transcript),
        destinationHandle: destination,
        exportManifest,
      })
    } finally {
      await destination.close()
    }

    expect(reads.most).toBe(4)
    const zip = await JSZip.loadAsync(await fs.readFile(destinationPath))
    const manifest: unknown = JSON.parse((await zip.file('manifest.json')?.async('string')) ?? '')
    expect(manifest).toMatchObject({
      entries: [
        ...resources.map((resource) => ({ path: resource.path })),
        { path: 'session.jsonl' },
      ],
    })
  })
})
