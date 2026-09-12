import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { PreparedAttachment } from '@shared/types/agent'
import { afterEach, describe, expect, it } from 'vitest'
import { hydrateAttachmentSources } from '../attachment-hydration'
import type { PreparedAttachmentSnapshot } from '../attachment-preparation'
import {
  configurePreparedAttachmentRegistry,
  rememberPreparedAttachment,
  resetPreparedAttachmentRegistryForTests,
  resolvePreparedAttachmentCapability,
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
  it('retains browser provenance on restart and rejects changed optional source metadata', async () => {
    const { userDataPath, filePath, attachment } = await makeFixture()
    const browserAttachment = {
      ...attachment,
      origin: 'browser-preview',
      browserPreview: {
        pageUrl: 'http://localhost:3000',
        pageTitle: 'Preview',
        selector: '#save',
        tagName: 'button',
        role: 'button',
        elementText: 'Save',
        comment: 'Check this',
        sourceFile: 'src/button.tsx',
        sourceLine: 12,
        elementCount: 1,
      },
    } satisfies PreparedAttachment
    configurePreparedAttachmentRegistry(userDataPath)
    await rememberPreparedAttachment(browserAttachment, filePath)
    resetPreparedAttachmentRegistryForTests()
    configurePreparedAttachmentRegistry(userDataPath)
    await expect(resolvePreparedAttachmentCapability(browserAttachment)).resolves.toMatchObject({
      browserPreview: browserAttachment.browserPreview,
    })
    await expect(
      resolvePreparedAttachmentCapability({
        ...browserAttachment,
        browserPreview: { ...browserAttachment.browserPreview, sourceLine: 99 },
      }),
    ).rejects.toThrow('metadata does not match')
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

  it('strips Host-only snapshot bytes before persisting a capability', async () => {
    const { userDataPath, filePath, attachment } = await makeFixture()
    configurePreparedAttachmentRegistry(userDataPath)
    const privateAttachment: PreparedAttachmentSnapshot = {
      ...attachment,
      immutableSourceBase64: 'aG9zdC1vbmx5LWJ5dGVz',
    }
    await rememberPreparedAttachment(privateAttachment, filePath)

    const files = await fs.readdir(userDataPath)
    const registryFile = files.find((entry) => entry.includes('attachment-capabilities'))
    const persisted = await fs.readFile(path.join(userDataPath, registryFile ?? ''), 'utf8')
    expect(persisted).not.toContain('immutableSourceBase64')
    expect(persisted).not.toContain('aG9zdC1vbmx5LWJ5dGVz')
  })
})
