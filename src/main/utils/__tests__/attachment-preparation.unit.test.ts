import fs, { appendFile, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { ATTACHMENT } from '@shared/constants/resource-limits'
import { afterEach, describe, expect, it } from 'vitest'
import { prepareAttachmentFiles } from '../attachment-preparation'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  )
})

describe('attachment preparation', () => {
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
