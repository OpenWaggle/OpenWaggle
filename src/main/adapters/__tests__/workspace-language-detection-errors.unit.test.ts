import { beforeEach, describe, expect, it, vi } from 'vitest'
import { vscodeLanguageAssociation } from '../workspace-language-detection'

const { readFileMock, statMock } = vi.hoisted(() => ({
  readFileMock: vi.fn(),
  statMock: vi.fn(),
}))

vi.mock('node:fs/promises', () => ({
  default: {
    readFile: readFileMock,
    stat: statMock,
  },
}))

function filesystemError(code: string) {
  return Object.assign(new Error(`Filesystem failed with ${code}`), { code })
}

describe('workspace language detection I/O boundaries', () => {
  beforeEach(() => {
    readFileMock.mockReset()
    statMock.mockReset()
  })

  it('treats only a missing VS Code settings file as optional', async () => {
    statMock.mockRejectedValueOnce(filesystemError('ENOENT'))

    await expect(vscodeLanguageAssociation('/missing-project', 'page.templ')).resolves.toBeNull()
  })

  it.each(['EACCES', 'EIO'])('propagates a %s settings stat failure', async (code) => {
    const failure = filesystemError(code)
    statMock.mockRejectedValueOnce(failure)

    await expect(vscodeLanguageAssociation(`/${code}-project`, 'page.templ')).rejects.toBe(failure)
  })

  it('propagates an operational settings read failure', async () => {
    const failure = filesystemError('EIO')
    statMock.mockResolvedValueOnce({ mtimeMs: 1, size: 10 })
    readFileMock.mockRejectedValueOnce(failure)

    await expect(vscodeLanguageAssociation('/unreadable-project', 'page.templ')).rejects.toBe(
      failure,
    )
  })

  it('rejects oversized settings before reading their contents', async () => {
    statMock.mockResolvedValueOnce({ mtimeMs: 1, size: 1024 * 1024 + 1 })

    await expect(vscodeLanguageAssociation('/oversized-project', 'page.templ')).rejects.toThrow(
      'VS Code workspace settings are limited to 1 MiB.',
    )
    expect(readFileMock).not.toHaveBeenCalled()
  })
})
