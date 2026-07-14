import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TrustedMainActivationDependenciesTestLayer } from '../../application/__tests__/extension-trusted-main-activation-test-layer'
import { getExtensionPackageWriteProposalHash } from '../../application/extension-package-workflow-model'
import { ExtensionLifecycleRepository } from '../../ports/extension-lifecycle-repository'
import { ExtensionManagerService } from '../../ports/extension-manager-service'
import { ExtensionPackageRepository } from '../../ports/extension-package-repository'
import { ExtensionProjectOverridesRepository } from '../../ports/extension-project-overrides-repository'

const { typedHandleMock, listPackagesMock, writePackageMock } = vi.hoisted(() => ({
  typedHandleMock: vi.fn(),
  listPackagesMock: vi.fn(),
  writePackageMock: vi.fn(),
}))

vi.mock('../typed-ipc', () => ({
  typedHandle: typedHandleMock,
}))

import { registerExtensionsHandlers } from '../extensions-handler'

function makeTestLayer() {
  return Layer.mergeAll(
    Layer.succeed(ExtensionManagerService, {
      listPackages: (input) => Effect.sync(() => listPackagesMock(input)),
    }),
    Layer.succeed(ExtensionLifecycleRepository, {
      get: () => Effect.succeed(null),
      list: () => Effect.succeed([]),
      upsert: () => Effect.void,
      delete: () => Effect.void,
    }),
    Layer.succeed(ExtensionProjectOverridesRepository, {
      get: () => Effect.succeed(null),
      upsert: () => Effect.void,
    }),
    Layer.succeed(ExtensionPackageRepository, {
      writePackage: (input) =>
        Effect.sync(() => {
          writePackageMock(input)
          return {
            packagePath: '/tmp/package',
            manifestPath: '/tmp/package/openwaggle.extension.json',
            mode: input.mode,
          }
        }),
      removePackage: () => Effect.succeed({ packagePath: '/tmp/package', removed: false }),
    }),
    TrustedMainActivationDependenciesTestLayer,
  )
}

function packageWriteFiles(extensionId: string) {
  return [
    {
      relativePath: OPENWAGGLE_EXTENSION.MANIFEST_FILE,
      content: `${JSON.stringify({
        manifestVersion: 1,
        id: extensionId,
        name: 'IPC Extension',
        version: '1.0.0',
        sdk: { openwaggle: '>=0.1.0 <0.2.0' },
        sourceFiles: ['src/index.ts'],
        builtArtifacts: ['dist/index.js'],
      })}\n`,
    },
    {
      relativePath: 'src/index.ts',
      content: 'export const source = true\n',
    },
    {
      relativePath: 'dist/index.js',
      content: 'export const built = true\n',
    },
  ]
}

function approvedPackageWriteInput(input: {
  readonly extensionId: string
  readonly projectPath: string
  readonly files: ReturnType<typeof packageWriteFiles>
}) {
  const scope = { kind: OPENWAGGLE_EXTENSION.SCOPE.PROJECT_KIND, projectPath: input.projectPath }
  const proposalHash = getExtensionPackageWriteProposalHash({
    extensionId: input.extensionId,
    scope,
    mode: 'create',
    files: input.files,
  })

  return {
    extensionId: input.extensionId,
    scope,
    mode: 'create',
    files: input.files,
    actor: { kind: 'agent', agentId: 'agent-1' },
    userApproval: {
      approved: true,
      approvedProposalHash: proposalHash,
      approvedBy: 'User',
      approvedAt: 1000,
    },
  }
}

function getRegisteredHandler(name: string, layer = makeTestLayer()) {
  const call = typedHandleMock.mock.calls.find(
    (candidate: readonly unknown[]) => candidate[0] === name && typeof candidate[1] === 'function',
  )
  const handler = call?.[1]
  if (typeof handler !== 'function') {
    return undefined
  }
  return (...args: unknown[]) => Effect.runPromise(Effect.provide(handler(...args), layer))
}

describe('registerExtensionsHandlers package write workflow', () => {
  beforeEach(() => {
    typedHandleMock.mockReset()
    listPackagesMock.mockReset()
    writePackageMock.mockReset()
    listPackagesMock.mockReturnValue([])
  })

  it('registers extensions:propose-package-write and returns an approval hash', async () => {
    const projectPath = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-ipc-propose-'))
    const realProjectPath = await fs.realpath(projectPath)
    const extensionId = 'ipc-proposal-extension'
    const files = packageWriteFiles(extensionId)
    registerExtensionsHandlers()
    const handler = getRegisteredHandler('extensions:propose-package-write')

    try {
      const proposal = await handler?.(
        {},
        {
          extensionId,
          scope: { kind: 'project', projectPath },
          mode: 'create',
          files,
          actor: { kind: 'agent', agentId: 'agent-1' },
          viewProjectPaths: [projectPath],
        },
      )

      expect(proposal).toMatchObject({
        extensionId,
        scope: { kind: 'project', projectPath: realProjectPath },
        mode: 'create',
        operation: 'write:create',
        proposalHash: getExtensionPackageWriteProposalHash({
          extensionId,
          scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.PROJECT_KIND, projectPath: realProjectPath },
          mode: 'create',
          files,
        }),
        requiresGlobalConfirmation: false,
      })
      expect(listPackagesMock).toHaveBeenCalledWith({ projectPath: realProjectPath })
      expect(writePackageMock).not.toHaveBeenCalled()
    } finally {
      await fs.rm(projectPath, { recursive: true, force: true })
    }
  })

  it('registers extensions:apply-package-write and writes only after approval', async () => {
    const projectPath = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-ipc-apply-'))
    const realProjectPath = await fs.realpath(projectPath)
    const extensionId = 'ipc-apply-extension'
    const files = packageWriteFiles(extensionId)
    registerExtensionsHandlers()
    const handler = getRegisteredHandler('extensions:apply-package-write')

    try {
      await handler?.(
        {},
        approvedPackageWriteInput({ extensionId, projectPath: realProjectPath, files }),
      )

      expect(writePackageMock).toHaveBeenCalledWith({
        extensionId,
        scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.PROJECT_KIND, projectPath: realProjectPath },
        mode: 'create',
        files,
      })
    } finally {
      await fs.rm(projectPath, { recursive: true, force: true })
    }
  })
})
