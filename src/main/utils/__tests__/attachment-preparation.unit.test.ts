import fs, { appendFile, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { ATTACHMENT } from '@shared/constants/resource-limits'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { prepareAttachmentFiles } from '../attachment-preparation'

const mocks = vi.hoisted(() => ({
  extractAttachmentText: vi.fn(async () => ''),
}))

vi.mock('../attachment-text-extraction', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../attachment-text-extraction')>()),
  extractAttachmentText: mocks.extractAttachmentText,
}))

const temporaryDirectories: string[] = []

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  )
})

describe('attachment preparation', () => {
  it('snapshots browser context before asynchronous file reads and keeps distinct annotations', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'openwaggle-browser-attachment-'))
    temporaryDirectories.push(directory)
    const source = path.join(directory, 'capture.png')
    await writeFile(source, 'captured image bytes')
    const metadata = {
      pageUrl: 'http://localhost:3000',
      pageTitle: 'Preview',
      selector: '#save',
      tagName: 'button',
      role: 'button',
      elementText: 'Save',
      comment: 'Make this clear',
      sourceLine: 12,
    }
    const result = await prepareAttachmentFiles({
      baseDirectory: directory,
      entries: [
        {
          path: source,
          origin: 'browser-preview',
          browserPreview: metadata,
          browserAnnotationText: 'Untrusted page context: original',
        },
        {
          path: source,
          origin: 'browser-preview',
          browserPreview: { ...metadata, comment: 'Another observation' },
        },
      ],
      beforeRead: async () => {
        metadata.comment = 'changed later'
      },
    })
    expect(result).toHaveLength(2)
    expect(result[0]?.browserPreview?.comment).toBe('Make this clear')
    expect(result[0]?.extractedText).toBe('Untrusted page context: original')
    expect(result[1]?.browserPreview?.comment).toBe('Another observation')
  })

  it('validates aggregate raw bytes before starting any extraction', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'openwaggle-attachment-total-'))
    temporaryDirectories.push(directory)
    const perFileSize = Math.floor(ATTACHMENT.MAX_TOTAL_SIZE_BYTES / 3) + 1
    const payload = Buffer.alloc(perFileSize)
    const sources = ['one.txt', 'two.txt', 'three.txt'].map((name) => path.join(directory, name))
    await Promise.all(sources.map((source) => writeFile(source, payload)))

    await expect(
      prepareAttachmentFiles({
        baseDirectory: directory,
        entries: sources.map((source) => ({ path: source })),
      }),
    ).rejects.toThrow('Total attachment size exceeds 20 MB')

    expect(mocks.extractAttachmentText).not.toHaveBeenCalled()
  })

  it('captures immutable bytes before the source path can be replaced', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'openwaggle-attachment-'))
    temporaryDirectories.push(directory)
    const source = path.join(directory, 'evidence.txt')
    const original = Buffer.from('original evidence')
    await writeFile(source, original)

    const [prepared] = await prepareAttachmentFiles({
      baseDirectory: directory,
      entries: [{ path: source }],
    })
    await writeFile(source, 'replacement evidence')

    expect(Buffer.from(prepared?.immutableSourceBase64 ?? '', 'base64')).toEqual(original)
  })

  it('rejects a file that grows beyond the byte limit after its metadata check', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'openwaggle-attachment-growth-'))
    temporaryDirectories.push(directory)
    const source = path.join(directory, 'growing.log')
    await writeFile(source, 'initial')

    await expect(
      prepareAttachmentFiles({
        baseDirectory: directory,
        entries: [{ path: source }],
        beforeRead: async () => {
          await appendFile(source, Buffer.alloc(ATTACHMENT.MAX_SIZE_BYTES))
        },
      }),
    ).rejects.toThrow('Attachment exceeds 8 MB')
  })

  it('confines restricted attachment paths to canonical allowed workspace roots', async () => {
    const directory = await fs.realpath(
      await mkdtemp(path.join(os.tmpdir(), 'openwaggle-attachment-scope-')),
    )
    temporaryDirectories.push(directory)
    const workspace = path.join(directory, 'workspace')
    const outside = path.join(directory, 'outside.txt')
    const linked = path.join(workspace, 'linked.txt')
    await fs.mkdir(workspace)
    await writeFile(outside, 'private')
    await fs.symlink(outside, linked)

    await expect(
      prepareAttachmentFiles({
        baseDirectory: workspace,
        entries: [{ path: linked }],
        allowedRoots: [workspace],
      }),
    ).rejects.toThrow('symbolic links are not accepted')
  })

  it('keeps the authorized descriptor pinned across a pathname swap', async () => {
    if (process.platform === 'win32') return
    const directory = await fs.realpath(
      await mkdtemp(path.join(os.tmpdir(), 'openwaggle-attachment-race-')),
    )
    temporaryDirectories.push(directory)
    const workspace = path.join(directory, 'workspace')
    const source = path.join(workspace, 'evidence.txt')
    const displaced = path.join(workspace, 'evidence-authorized.txt')
    const outside = path.join(directory, 'private.txt')
    await fs.mkdir(workspace)
    await writeFile(source, 'safe evidence')
    await writeFile(outside, 'private data')

    const [prepared] = await prepareAttachmentFiles({
      baseDirectory: workspace,
      entries: [{ path: source }],
      allowedRoots: [workspace],
      beforeRead: async () => {
        await fs.rename(source, displaced)
        await fs.symlink(outside, source)
      },
    })

    expect(Buffer.from(prepared?.immutableSourceBase64 ?? '', 'base64').toString('utf8')).toBe(
      'safe evidence',
    )
  })

  it('rejects an attachment root retargeted through a symlink after the grant', async () => {
    if (process.platform === 'win32') return
    const directory = await mkdtemp(path.join(os.tmpdir(), 'openwaggle-attachment-root-race-'))
    temporaryDirectories.push(directory)
    const workspace = path.join(directory, 'workspace')
    const authorized = path.join(directory, 'workspace-authorized')
    const outside = path.join(directory, 'outside')
    await Promise.all([fs.mkdir(workspace), fs.mkdir(outside)])
    await writeFile(path.join(outside, 'private.txt'), 'private')
    await fs.rename(workspace, authorized)
    await fs.symlink(outside, workspace)

    await expect(
      prepareAttachmentFiles({
        baseDirectory: workspace,
        entries: [{ path: 'private.txt' }],
        allowedRoots: [workspace],
      }),
    ).rejects.toThrow('changed after it was granted')
  })
})
