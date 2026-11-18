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
    handleStatMock.mockReset().mockResolvedValue({
      ctimeMs: 1,
      dev: 1,
      ino: 1,
      isFile: () => true,
      mtimeMs: 1,
      size: 2,
    })
    lstatMock.mockReset().mockResolvedValue({ isFile: () => true, isSymbolicLink: () => false })
    openMock.mockReset().mockResolvedValue({
      close: closeMock,
      read: readMock,
      stat: handleStatMock,
    })
    readMock.mockReset().mockImplementation((buffer: Buffer, offset: number) => {
      if (offset > 0) return Promise.resolve({ bytesRead: 0 })
      buffer.write('{}', offset)
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

  it('continues bounded reads after a legal short read', async () => {
    const source = JSON.stringify({ 'files.associations': { '*.templ': 'html' } })
    handleStatMock.mockResolvedValueOnce({
      ctimeMs: 1,
      dev: 1,
      ino: 1,
      isFile: () => true,
      mtimeMs: 1,
      size: source.length,
    })
    readMock.mockImplementation((buffer: Buffer, offset: number, length: number) => {
      const chunk = source.slice(offset, offset + Math.min(length, 7))
      if (!chunk) return Promise.resolve({ bytesRead: 0 })
      buffer.write(chunk, offset)
      return Promise.resolve({ bytesRead: Buffer.byteLength(chunk) })
    })

    await expect(vscodeLanguageAssociation('/short-read-project', 'page.templ')).resolves.toBe(
      'html',
    )
    expect(readMock.mock.calls.length).toBeGreaterThan(1)
  })

  it('reloads associations when file identity changes without an mtime change', async () => {
    const firstSource = JSON.stringify({ 'files.associations': { '*.templ': 'html' } })
    const secondSource = JSON.stringify({ 'files.associations': { '*.templ': 'json' } })
    let activeSource = firstSource
    handleStatMock
      .mockResolvedValueOnce({
        ctimeMs: 1,
        dev: 1,
        ino: 1,
        isFile: () => true,
        mtimeMs: 1,
        size: firstSource.length,
      })
      .mockResolvedValueOnce({
        ctimeMs: 2,
        dev: 1,
        ino: 1,
        isFile: () => true,
        mtimeMs: 1,
        size: secondSource.length,
      })
    readMock.mockImplementation((buffer: Buffer, offset: number, length: number) => {
      const chunk = activeSource.slice(offset, offset + length)
      if (!chunk) return Promise.resolve({ bytesRead: 0 })
      buffer.write(chunk, offset)
      return Promise.resolve({ bytesRead: Buffer.byteLength(chunk) })
    })

    await expect(vscodeLanguageAssociation('/identity-project', 'page.templ')).resolves.toBe('html')
    activeSource = secondSource
    await expect(vscodeLanguageAssociation('/identity-project', 'page.templ')).resolves.toBe('json')
  })

  it('rejects oversized settings before reading their contents', async () => {
    handleStatMock.mockResolvedValueOnce({
      ctimeMs: 1,
      dev: 1,
      ino: 1,
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
    handleStatMock.mockResolvedValueOnce({
      ctimeMs: 1,
      dev: 1,
      ino: 1,
      isFile: () => false,
      mtimeMs: 1,
      size: 0,
    })

    await expect(vscodeLanguageAssociation('/device-project', 'page.templ')).rejects.toThrow(
      'regular non-symlink file',
    )
    expect(readMock).not.toHaveBeenCalled()
  })
})
