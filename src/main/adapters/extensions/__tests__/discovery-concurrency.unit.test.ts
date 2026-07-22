import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  calculateContentHashMock,
  diagnoseRuntimeRequirementsMock,
  getExtensionBuildPlanMock,
  loadExtensionManifestMock,
  readdirMock,
  validateDeclaredFilesMock,
} = vi.hoisted(() => ({
  calculateContentHashMock: vi.fn(),
  diagnoseRuntimeRequirementsMock: vi.fn(),
  getExtensionBuildPlanMock: vi.fn(),
  loadExtensionManifestMock: vi.fn(),
  readdirMock: vi.fn(),
  validateDeclaredFilesMock: vi.fn(),
}))

vi.mock('node:fs/promises', () => ({ readdir: readdirMock }))
vi.mock('../build-plan', () => ({ getExtensionBuildPlan: getExtensionBuildPlanMock }))
vi.mock('../manifest-loader', () => ({ loadExtensionManifest: loadExtensionManifestMock }))
vi.mock('../package-files', () => ({
  calculateContentHash: calculateContentHashMock,
  validateDeclaredFiles: validateDeclaredFilesMock,
}))
vi.mock('../runtime-requirements', () => ({
  diagnoseRuntimeRequirements: diagnoseRuntimeRequirementsMock,
}))

import { discoverExtensionPackages } from '../discovery'

function pendingOperation() {
  let release: (() => void) | undefined
  const pending = new Promise<void>((resolve) => {
    release = resolve
  })
  return { pending, release: () => release?.() }
}

describe('extension package discovery concurrency', () => {
  beforeEach(() => {
    calculateContentHashMock.mockReset()
    diagnoseRuntimeRequirementsMock.mockReset()
    getExtensionBuildPlanMock.mockReset()
    loadExtensionManifestMock.mockReset()
    readdirMock.mockReset()
    validateDeclaredFilesMock.mockReset()
  })

  it('starts independent package analysis after manifest decoding without changing result order', async () => {
    const operation = pendingOperation()
    readdirMock.mockResolvedValue([{ isDirectory: () => true, name: 'sample-extension' }])
    loadExtensionManifestMock.mockResolvedValue({
      diagnostics: [],
      manifest: {
        manifestVersion: 1,
        id: 'sample-extension',
        name: 'Sample Extension',
        version: '1.0.0',
        sdk: { openwaggle: '>=0.1.0 <0.2.0' },
        sourceFiles: ['src/index.ts'],
        builtArtifacts: ['dist/index.js'],
      },
      rawManifest: '{}',
    })
    validateDeclaredFilesMock.mockImplementation(async () => {
      await operation.pending
      return []
    })
    calculateContentHashMock.mockImplementation(async () => {
      await operation.pending
      return { contentHash: 'hash', diagnostics: [] }
    })
    getExtensionBuildPlanMock.mockImplementation(async () => {
      await operation.pending
      return { buildPlan: null, diagnostics: [] }
    })
    diagnoseRuntimeRequirementsMock.mockImplementation(async () => {
      await operation.pending
      return []
    })

    const discovery = discoverExtensionPackages({
      globalRootPath: '/extensions',
      hostSdkVersion: OPENWAGGLE_EXTENSION.SDK_VERSION,
    })
    for (let index = 0; index < 5; index += 1) {
      await Promise.resolve()
    }

    expect(validateDeclaredFilesMock).toHaveBeenCalledTimes(2)
    expect(calculateContentHashMock).toHaveBeenCalledTimes(1)
    expect(getExtensionBuildPlanMock).toHaveBeenCalledTimes(1)
    expect(diagnoseRuntimeRequirementsMock).toHaveBeenCalledTimes(1)
    operation.release()

    await expect(discovery).resolves.toMatchObject([{ id: 'sample-extension', diagnostics: [] }])
  })
})
