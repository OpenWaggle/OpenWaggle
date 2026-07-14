import path from 'node:path'
import type { OpenWaggleExtensionManifest } from '@shared/schemas/extensions'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { accessMock, getSafeChildEnvMock } = vi.hoisted(() => ({
  accessMock: vi.fn(),
  getSafeChildEnvMock: vi.fn(),
}))

vi.mock('node:fs/promises', () => ({ access: accessMock }))
vi.mock('../../../env', () => ({ getSafeChildEnv: getSafeChildEnvMock }))

import { diagnoseRuntimeRequirements } from '../runtime-requirements'

const MANIFEST = {
  manifestVersion: 1,
  id: 'sample-extension',
  name: 'Sample Extension',
  version: '1.0.0',
  sdk: { openwaggle: '>=0.1.0 <0.2.0' },
  sourceFiles: [],
  builtArtifacts: [],
  runtimeRequirements: [
    {
      kind: 'binary',
      id: 'sample.binary',
      label: 'Sample binary',
      binary: 'sample-cli',
    },
  ],
} satisfies OpenWaggleExtensionManifest

function pendingOperation() {
  let release: (() => void) | undefined
  const pending = new Promise<void>((resolve) => {
    release = resolve
  })
  return { pending, release: () => release?.() }
}

describe('extension runtime requirement concurrency', () => {
  beforeEach(() => {
    accessMock.mockReset()
    getSafeChildEnvMock.mockReset()
  })

  it('probes independent PATH candidates concurrently', async () => {
    const operation = pendingOperation()
    getSafeChildEnvMock.mockReturnValue({ PATH: ['/first', '/second'].join(path.delimiter) })
    accessMock.mockImplementation(async () => {
      await operation.pending
      throw new Error('missing')
    })

    const diagnosis = diagnoseRuntimeRequirements({
      packagePath: '/extension',
      manifest: MANIFEST,
    })
    await Promise.resolve()

    expect(accessMock).toHaveBeenCalledTimes(2)
    operation.release()

    await expect(diagnosis).resolves.toMatchObject([{ code: 'runtime-requirement-missing' }])
  })
})
