import { beforeEach, describe, expect, it, vi } from 'vitest'

const { readFileMock, realpathMock, statMock } = vi.hoisted(() => ({
  readFileMock: vi.fn(),
  realpathMock: vi.fn(),
  statMock: vi.fn(),
}))

vi.mock('node:fs/promises', () => ({
  readFile: readFileMock,
  realpath: realpathMock,
  stat: statMock,
}))

import {
  calculateBuildPlanHash,
  calculateContentHash,
  validateDeclaredFiles,
} from '../package-files'

function pendingOperation() {
  let release: (() => void) | undefined
  const pending = new Promise<void>((resolve) => {
    release = resolve
  })
  return {
    pending,
    release: () => release?.(),
  }
}

describe('extension package file concurrency', () => {
  beforeEach(() => {
    readFileMock.mockReset()
    realpathMock.mockReset()
    statMock.mockReset()
  })

  it('inspects independent declared files concurrently while preserving diagnostic order', async () => {
    const operation = pendingOperation()
    realpathMock.mockImplementation(async (filePath: string) => {
      await operation.pending
      return filePath
    })
    statMock.mockResolvedValue({ isFile: () => false })

    const validation = validateDeclaredFiles({
      packagePath: '/extension',
      relativePaths: ['first.js', 'second.js'],
      label: 'built artifact',
      missingCode: 'built-artifact-missing',
    })
    await Promise.resolve()

    expect(realpathMock).toHaveBeenCalledTimes(4)
    operation.release()

    await expect(validation).resolves.toMatchObject([
      { code: 'built-artifact-missing', path: '/extension/first.js' },
      { code: 'built-artifact-missing', path: '/extension/second.js' },
    ])
  })

  it('reads independent hash inputs concurrently before applying them in deterministic order', async () => {
    const operation = pendingOperation()
    realpathMock.mockImplementation(async (filePath: string) => {
      await operation.pending
      return filePath
    })
    readFileMock.mockResolvedValue(Buffer.from('content'))

    const calculation = calculateContentHash('/extension', '{}', {
      builtArtifacts: ['second.js', 'first.js'],
      runtimeFiles: [],
    })
    await Promise.resolve()

    expect(realpathMock).toHaveBeenCalledTimes(4)
    operation.release()

    await expect(calculation).resolves.toMatchObject({
      contentHash: expect.any(String),
      diagnostics: [],
    })
  })

  it('reads independent build-plan inputs concurrently before applying them in deterministic order', async () => {
    const operation = pendingOperation()
    realpathMock.mockImplementation(async (filePath: string) => {
      await operation.pending
      return filePath
    })
    readFileMock.mockResolvedValue(Buffer.from('source'))

    const calculation = calculateBuildPlanHash('/extension', '{}', {
      sourceFiles: ['second.ts', 'first.ts'],
      buildCommand: 'pnpm build',
    })
    await Promise.resolve()

    expect(realpathMock).toHaveBeenCalledTimes(4)
    operation.release()

    await expect(calculation).resolves.toMatchObject({
      contentHash: expect.any(String),
      diagnostics: [],
    })
  })
})
