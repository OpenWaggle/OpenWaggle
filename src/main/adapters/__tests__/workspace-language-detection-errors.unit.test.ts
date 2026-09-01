import { beforeEach, describe, expect, it, vi } from 'vitest'
import { vscodeLanguageAssociation } from '../workspace-language-detection'

const { closeMock, handleStatMock, lstatMock, openMock, readMock, realpathMock } = vi.hoisted(
  () => ({
    closeMock: vi.fn(),
    handleStatMock: vi.fn(),
    lstatMock: vi.fn(),
    openMock: vi.fn(),
    readMock: vi.fn(),
    realpathMock: vi.fn(),
  }),
)

vi.mock('node:fs/promises', () => ({
  default: {
    lstat: lstatMock,
    open: openMock,
    realpath: realpathMock,
  },
}))

function filesystemError(code: string) {
  return Object.assign(new Error(`Filesystem failed with ${code}`), { code })
}

describe('workspace language detection I/O boundaries', () => {
  beforeEach(() => {
    closeMock.mockReset().mockResolvedValue(undefined)
    handleStatMock.mockReset().mockResolvedValue({ isFile: () => true, mtimeMs: 1, size: 2 })
    lstatMock.mockReset().mockResolvedValue({ isFile: () => true, isSymbolicLink: () => false })
    openMock.mockReset().mockResolvedValue({
      close: closeMock,
      read: readMock,
      stat: handleStatMock,
    })
    readMock.mockReset().mockImplementation((buffer: Buffer) => {
      buffer.write('{}')
      return Promise.resolve({ bytesRead: 2 })
    })
    realpathMock.mockReset().mockImplementation((value: string) => Promise.resolve(value))
  })

  it('treats only a missing VS Code settings file as optional', async () => {
    lstatMock.mockRejectedValueOnce(filesystemError('ENOENT'))

    await expect(vscodeLanguageAssociation('/missing-project', 'page.templ')).resolves.toBeNull()
  })

  it.each(['EACCES', 'EIO'])('propagates a %s settings stat failure', async (code) => {
    const failure = filesystemError(code)
    lstatMock.mockRejectedValueOnce(failure)

    await expect(vscodeLanguageAssociation(`/${code}-project`, 'page.templ')).rejects.toBe(failure)
  })

  it('propagates an operational settings read failure', async () => {
    const failure = filesystemError('EIO')
    readMock.mockRejectedValueOnce(failure)

    await expect(vscodeLanguageAssociation('/unreadable-project', 'page.templ')).rejects.toBe(
      failure,
    )
    expect(closeMock).toHaveBeenCalledOnce()
  })

  it('rejects oversized settings before reading their contents', async () => {
    handleStatMock.mockResolvedValueOnce({
      isFile: () => true,
      mtimeMs: 1,
      size: 1024 * 1024 + 1,
    })

    await expect(vscodeLanguageAssociation('/oversized-project', 'page.templ')).rejects.toThrow(
      'VS Code workspace settings are limited to 1 MiB.',
    )
    expect(readMock).not.toHaveBeenCalled()
  })

  it('rejects settings symlinks before opening their targets', async () => {
    lstatMock.mockResolvedValueOnce({ isFile: () => false, isSymbolicLink: () => true })

    await expect(vscodeLanguageAssociation('/linked-project', 'page.templ')).rejects.toThrow(
      'regular non-symlink file',
    )
    expect(openMock).not.toHaveBeenCalled()
  })

  it('rejects non-regular settings handles before reading', async () => {
    handleStatMock.mockResolvedValueOnce({ isFile: () => false, mtimeMs: 1, size: 0 })

    await expect(vscodeLanguageAssociation('/device-project', 'page.templ')).rejects.toThrow(
      'regular non-symlink file',
    )
    expect(readMock).not.toHaveBeenCalled()
  })
})
