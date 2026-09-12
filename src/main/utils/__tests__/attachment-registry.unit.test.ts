import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { PreparedAttachment } from '@shared/types/agent'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { hydrateAttachmentSources } from '../attachment-hydration'
import {
  configurePreparedAttachmentRegistry,
  rememberPreparedAttachment,
  resetPreparedAttachmentRegistryForTests,
} from '../attachment-registry'

const temporaryDirectories: string[] = []

async function makeFixture() {
  const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-attachments-'))
  temporaryDirectories.push(userDataPath)
  const filePath = path.join(userDataPath, 'notes.txt')
  await fs.writeFile(filePath, 'Durable attachment contents')
  const attachment: PreparedAttachment = {
    id: 'attachment-durable-1',
    kind: 'text',
    origin: 'user-file',
    name: 'notes.txt',
    path: filePath,
    mimeType: 'text/plain',
    sizeBytes: Buffer.byteLength('Durable attachment contents'),
    contentSha256: createHash('sha256').update('Durable attachment contents').digest('hex'),
    extractedText: 'Durable attachment contents',
  }
  return { userDataPath, filePath, attachment }
}

afterEach(async () => {
  resetPreparedAttachmentRegistryForTests()
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true })),
  )
})

describe('prepared attachment registry', () => {
  it('hydrates prepared attachments with bounded filesystem concurrency', async () => {
    const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-attachments-'))
    temporaryDirectories.push(userDataPath)
    configurePreparedAttachmentRegistry(userDataPath)
    const attachments: PreparedAttachment[] = []
    for (let index = 0; index < 5; index += 1) {
      const bytes = Buffer.from(`image-${String(index)}`)
      const filePath = path.join(userDataPath, `image-${String(index)}.png`)
      await fs.writeFile(filePath, bytes)
      const attachment: PreparedAttachment = {
        id: `attachment-${String(index)}`,
        kind: 'image',
        origin: 'user-file',
        name: path.basename(filePath),
        path: filePath,
        mimeType: 'image/png',
        sizeBytes: bytes.byteLength,
        contentSha256: createHash('sha256').update(bytes).digest('hex'),
        extractedText: 'prepared image',
      }
      attachments.push(attachment)
      await rememberPreparedAttachment(attachment, filePath)
    }

    const stat = fs.stat.bind(fs)
    let active = 0
    let peak = 0
    const statSpy = vi.spyOn(fs, 'stat').mockImplementation(async (filePath) => {
      active += 1
      peak = Math.max(peak, active)
      await new Promise((resolve) => setTimeout(resolve, 10))
      try {
        return await stat(filePath)
      } finally {
        active -= 1
      }
    })

    try {
      const hydrated = await hydrateAttachmentSources(attachments)
      expect(hydrated.map(({ id }) => id)).toEqual(attachments.map(({ id }) => id))
      expect(peak).toBe(2)
    } finally {
      statSpy.mockRestore()
    }
  })

  it('rehydrates a compact capability after a full main-process restart', async () => {
    const { userDataPath, filePath, attachment } = await makeFixture()
    configurePreparedAttachmentRegistry(userDataPath)
    await rememberPreparedAttachment(attachment, filePath)

    resetPreparedAttachmentRegistryForTests()
    configurePreparedAttachmentRegistry(userDataPath)
    const [hydrated] = await hydrateAttachmentSources([{ ...attachment, extractedText: '' }])

    expect(hydrated).toMatchObject({
      id: attachment.id,
      extractedText: 'Durable attachment contents',
      source: null,
    })
  })

  it('keeps extracted contents out of the durable capability file', async () => {
    const { userDataPath, filePath, attachment } = await makeFixture()
    configurePreparedAttachmentRegistry(userDataPath)
    await rememberPreparedAttachment(attachment, filePath)

    const files = await fs.readdir(userDataPath)
    const registryFile = files.find((entry) => entry.includes('attachment-capabilities'))
    expect(registryFile).toBeDefined()
    const persisted = await fs.readFile(path.join(userDataPath, registryFile ?? ''), 'utf8')
    expect(persisted).not.toContain('Durable attachment contents')
  })

  it('rejects a same-size binary replacement after preparation', async () => {
    const { userDataPath, filePath, attachment } = await makeFixture()
    const binaryAttachment: PreparedAttachment = {
      ...attachment,
      kind: 'image',
      mimeType: 'image/png',
      extractedText: '',
    }
    configurePreparedAttachmentRegistry(userDataPath)
    await rememberPreparedAttachment(binaryAttachment, filePath)
    await fs.writeFile(filePath, 'Changed attachment contents')
    expect(Buffer.byteLength('Changed attachment contents')).toBe(binaryAttachment.sizeBytes)

    await expect(hydrateAttachmentSources([binaryAttachment])).rejects.toThrow(
      'Attachment changed after it was prepared',
    )
  })
})
