import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * A clipboard screenshot exists only in memory: `getPathForFile` answers nothing for it, so its
 * bytes are what reaches attachment preparation (ADR 0068).
 */
vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: vi.fn() },
  ipcRenderer: { invoke: vi.fn(), send: vi.fn(), on: vi.fn(), removeListener: vi.fn() },
  webUtils: { getPathForFile: vi.fn() },
}))

import { ipcRenderer, webUtils } from 'electron'
import { prepareSelectedAttachments } from '../electron-transport'

function preparedImage(name: string) {
  return {
    id: `attachment-${name}`,
    kind: 'image' as const,
    name,
    path: `/tmp/prepared/${name}`,
    mimeType: 'image/png',
    sizeBytes: 4,
    extractedText: '',
  }
}

function screenshotFile() {
  return new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'image.png', { type: 'image/png' })
}

describe('prepareSelectedAttachments', () => {
  beforeEach(() => vi.clearAllMocks())

  it('prepares a screenshot that exists only on the clipboard, with no on-disk path', async () => {
    vi.mocked(webUtils.getPathForFile).mockReturnValue('')
    vi.mocked(ipcRenderer.invoke).mockResolvedValueOnce(preparedImage('image.png'))
    const screenshot = screenshotFile()

    const result = await prepareSelectedAttachments('/repo', [screenshot])

    expect(ipcRenderer.invoke).toHaveBeenCalledWith(
      'attachments:prepare-image-from-bytes',
      new Uint8Array(await screenshot.arrayBuffer()),
      'image.png',
      'image/png',
    )
    expect(result).toEqual([{ attachment: preparedImage('image.png'), fileIndex: 0 }])
  })

  it('reads a file the clipboard names by path instead of its bytes', async () => {
    vi.mocked(webUtils.getPathForFile).mockReturnValue('/repo/shot.png')
    vi.mocked(ipcRenderer.invoke).mockResolvedValueOnce([preparedImage('shot.png')])
    const shot = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'shot.png', {
      type: 'image/png',
    })

    const result = await prepareSelectedAttachments('/repo', [shot])

    expect(ipcRenderer.invoke).toHaveBeenCalledWith('attachments:prepare', '/repo', [
      '/repo/shot.png',
    ])
    expect(result).toEqual([{ attachment: preparedImage('shot.png'), fileIndex: 0 }])
  })

  it('leaves an untyped pathless file for main to type by its name', async () => {
    vi.mocked(webUtils.getPathForFile).mockReturnValue('')
    vi.mocked(ipcRenderer.invoke).mockResolvedValueOnce(preparedImage('IMG_4521.HEIC'))
    const photo = new File([new Uint8Array([0, 0, 0, 0x24])], 'IMG_4521.HEIC')

    const result = await prepareSelectedAttachments('/repo', [photo])

    expect(ipcRenderer.invoke).toHaveBeenCalledWith(
      'attachments:prepare-image-from-bytes',
      new Uint8Array(await photo.arrayBuffer()),
      'IMG_4521.HEIC',
      '',
    )
    expect(result).toEqual([{ attachment: preparedImage('IMG_4521.HEIC'), fileIndex: 0 }])
  })

  it('keeps the order of files prepared by path and by bytes', async () => {
    vi.mocked(webUtils.getPathForFile).mockImplementation((file) =>
      file.name === 'shot.png' ? '/repo/shot.png' : '',
    )
    vi.mocked(ipcRenderer.invoke).mockImplementation((channel) =>
      Promise.resolve(
        channel === 'attachments:prepare'
          ? [preparedImage('shot.png')]
          : preparedImage('image.png'),
      ),
    )
    const shot = new File([new Uint8Array([0x89])], 'shot.png', { type: 'image/png' })

    const result = await prepareSelectedAttachments('/repo', [screenshotFile(), shot])

    expect(result).toEqual([
      { attachment: preparedImage('image.png'), fileIndex: 0 },
      { attachment: preparedImage('shot.png'), fileIndex: 1 },
    ])
  })

  it('ignores a pathless file that is not an image', async () => {
    vi.mocked(webUtils.getPathForFile).mockReturnValue('')
    const notes = new File(['notes'], 'notes.txt', { type: 'text/plain' })

    const result = await prepareSelectedAttachments('/repo', [notes])

    expect(result).toEqual([])
    expect(ipcRenderer.invoke).not.toHaveBeenCalled()
  })
})
