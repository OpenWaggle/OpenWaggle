import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runtimeModuleUrl, writeExtensionPackage, writeText } from './renderer-protocol-test-utils'

const HTTP_NOT_FOUND_STATUS = 404
// Full-suite workers can contend while Vitest transforms the renderer protocol graph.
const MODULE_LOAD_TEST_TIMEOUT_MS = 60_000

/** Module requests the protocol refuses before reading any file; each overrides one URL part. */
const REFUSED_MODULE_REQUESTS: readonly {
  readonly name: string
  readonly contentHash?: string
  readonly relativePath?: string
  readonly packageDirectory?: string
}[] = [
  { name: 'a stale content hash', contentHash: 'stale-hash' },
  { name: 'a package file outside the manifest hash input', relativePath: 'dist/undeclared.js' },
  { name: 'a path that climbs out of the package', relativePath: '%2e%2e/secret.js' },
  { name: 'a directory that is not an extension package', packageDirectory: 'not-an-extension' },
]

const protocolMocks = await vi.hoisted(async () => {
  const { fakeAppPaths, fakeNetworkFetch, fakeTrustedOrigins } =
    await import('../test-support/fake-desktop-shell')
  const networkFetch = fakeNetworkFetch()
  networkFetch.fetch.mockImplementation((input) =>
    Promise.resolve(new Response(typeof input === 'string' ? input : input.url)),
  )
  return {
    is: { dev: false },
    env: { ELECTRON_RENDERER_URL: '' },
    appPaths: fakeAppPaths('/tmp/user-data'),
    existsSync: vi.fn(),
    networkFetch,
    trustedOrigins: fakeTrustedOrigins(),
  }
})

vi.mock('node:fs', () => ({
  existsSync: protocolMocks.existsSync,
}))

vi.mock('../desktop-shell/app-lifecycle', async () => ({
  appLifecycle: (await import('../test-support/fake-desktop-shell')).fakeAppLifecycle({
    isPackaged: () => !protocolMocks.is.dev,
  }),
}))
vi.mock('../desktop-shell/app-paths', () => ({ appPaths: protocolMocks.appPaths }))
vi.mock('../desktop-shell/network-fetch', () => ({ networkFetch: protocolMocks.networkFetch }))
vi.mock('../desktop-shell/trusted-origins', () => ({
  trustedOrigins: protocolMocks.trustedOrigins,
}))

vi.mock('../env', () => ({
  env: protocolMocks.env,
}))

let tmpRoot = ''

function allowRuntimeModuleAccess() {
  return {
    isExtensionRuntimeModuleAllowed: vi.fn(() => Promise.resolve(true)),
  }
}

async function loadRendererProtocol() {
  return import('../extension-runtime-protocol')
}

function dispatchProtocolRequest(url: string) {
  return protocolMocks.trustedOrigins.dispatchUrl(url)
}

describe('extension runtime protocol', () => {
  beforeEach(async () => {
    vi.resetModules()
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-runtime-protocol-'))
    protocolMocks.is.dev = false
    protocolMocks.env.ELECTRON_RENDERER_URL = ''
    protocolMocks.appPaths.setUserData(path.join(tmpRoot, 'user-data'))
    protocolMocks.networkFetch.fetch.mockClear()
    protocolMocks.trustedOrigins.reset()
  })

  afterEach(async () => {
    if (tmpRoot) {
      await fs.rm(tmpRoot, { recursive: true, force: true })
      tmpRoot = ''
    }
  })

  it(
    'serves hash-covered runtime entries and relative chunks from project packages',
    async () => {
      const { registerExtensionRuntimeProtocolOnce } = await loadRendererProtocol()
      const projectPath = path.join(tmpRoot, 'project')
      const extensionPackage = await writeExtensionPackage({
        projectPath,
        scope: 'project',
        builtArtifacts: ['dist/route.js', 'dist/chunk.js'],
        tmpRoot,
      })

      const access = allowRuntimeModuleAccess()
      registerExtensionRuntimeProtocolOnce(access)

      const routeUrl = runtimeModuleUrl({
        packagePath: extensionPackage.packagePath,
        contentHash: extensionPackage.contentHash,
        relativePath: 'dist/route.js',
        projectPaths: [projectPath],
      })
      const chunkUrl = new URL('./chunk.js', routeUrl).href

      const routeResponse = await dispatchProtocolRequest(routeUrl)
      expect(routeResponse.headers.get('access-control-allow-origin')).toBe('*')
      expect(await routeResponse.text()).toContain('dist/route.js')
      expect(await (await dispatchProtocolRequest(chunkUrl)).text()).toContain('dist/chunk.js')
      expect(access.isExtensionRuntimeModuleAllowed).toHaveBeenCalledWith({
        packagePath: extensionPackage.packagePath,
        contentHash: extensionPackage.contentHash,
        projectPaths: [projectPath],
      })
    },
    MODULE_LOAD_TEST_TIMEOUT_MS,
  )

  // Regression for the return-await fix: the handler returned the file read's promise from
  // inside its try, so a read that failed after the access check rejected instead of a 404.
  it(
    'answers 404 when an allowed module cannot be read',
    async () => {
      const { registerExtensionRuntimeProtocolOnce } = await loadRendererProtocol()
      const projectPath = path.join(tmpRoot, 'project')
      const extensionPackage = await writeExtensionPackage({
        projectPath,
        scope: 'project',
        builtArtifacts: ['dist/route.js'],
        tmpRoot,
      })
      registerExtensionRuntimeProtocolOnce(allowRuntimeModuleAccess())
      protocolMocks.networkFetch.fetch.mockRejectedValueOnce(
        new Error('ENOENT: the module was removed'),
      )

      const response = await dispatchProtocolRequest(
        runtimeModuleUrl({
          packagePath: extensionPackage.packagePath,
          contentHash: extensionPackage.contentHash,
          relativePath: 'dist/route.js',
          projectPaths: [projectPath],
        }),
      )

      expect(response.status).toBe(HTTP_NOT_FOUND_STATUS)
    },
    MODULE_LOAD_TEST_TIMEOUT_MS,
  )

  it('serves hash-covered runtime entries from global extension packages', async () => {
    const { registerExtensionRuntimeProtocolOnce } = await loadRendererProtocol()
    const projectPath = path.join(tmpRoot, 'project')
    const globalRootPath = path.join(tmpRoot, 'user-data', 'extensions')
    const extensionPackage = await writeExtensionPackage({
      projectPath,
      globalRootPath,
      scope: 'global',
      tmpRoot,
    })

    registerExtensionRuntimeProtocolOnce(allowRuntimeModuleAccess())

    const routeUrl = runtimeModuleUrl({
      packagePath: extensionPackage.packagePath,
      contentHash: extensionPackage.contentHash,
      relativePath: 'dist/route.js',
    })

    expect(await (await dispatchProtocolRequest(routeUrl)).text()).toContain('dist/route.js')
  })

  it('keeps session context in access checks for entries and their relative chunks', async () => {
    const { registerExtensionRuntimeProtocolOnce } = await loadRendererProtocol()
    const projectPath = path.join(tmpRoot, 'project')
    const extensionPackage = await writeExtensionPackage({
      projectPath,
      scope: 'project',
      builtArtifacts: ['dist/route.js', 'dist/chunk.js'],
      tmpRoot,
    })
    const access = allowRuntimeModuleAccess()

    registerExtensionRuntimeProtocolOnce(access)

    const routeUrl = runtimeModuleUrl({
      packagePath: extensionPackage.packagePath,
      contentHash: extensionPackage.contentHash,
      relativePath: 'dist/route.js',
      projectPaths: [projectPath],
      sessionId: 'session-1',
    })
    const sessionAccess = {
      packagePath: extensionPackage.packagePath,
      contentHash: extensionPackage.contentHash,
      projectPaths: [projectPath],
      sessionId: 'session-1',
    }

    expect(await (await dispatchProtocolRequest(routeUrl)).text()).toContain('dist/route.js')
    expect(access.isExtensionRuntimeModuleAllowed).toHaveBeenLastCalledWith(sessionAccess)
    const chunkUrl = new URL('./chunk.js', routeUrl).href
    expect(await (await dispatchProtocolRequest(chunkUrl)).text()).toContain('dist/chunk.js')
    expect(access.isExtensionRuntimeModuleAllowed).toHaveBeenLastCalledWith(sessionAccess)
  })

  it.each(REFUSED_MODULE_REQUESTS)('answers 404 for $name', async (request) => {
    const { registerExtensionRuntimeProtocolOnce } = await loadRendererProtocol()
    const projectPath = path.join(tmpRoot, 'project')
    const extensionPackage = await writeExtensionPackage({
      projectPath,
      scope: 'project',
      builtArtifacts: ['dist/route.js'],
      tmpRoot,
    })
    await writeText(
      path.join(extensionPackage.packagePath, 'dist', 'undeclared.js'),
      'export const undeclared = true\n',
    )
    registerExtensionRuntimeProtocolOnce(allowRuntimeModuleAccess())

    const url = runtimeModuleUrl({
      packagePath: request.packageDirectory
        ? path.join(projectPath, request.packageDirectory)
        : extensionPackage.packagePath,
      contentHash: request.contentHash ?? extensionPackage.contentHash,
      relativePath: request.relativePath ?? 'dist/route.js',
    })

    expect((await dispatchProtocolRequest(url)).status).toBe(HTTP_NOT_FOUND_STATUS)
  })

  it('rejects hash-covered runtime files that resolve outside the extension package', async () => {
    const { registerExtensionRuntimeProtocolOnce } = await loadRendererProtocol()
    const projectPath = path.join(tmpRoot, 'project')
    const extensionPackage = await writeExtensionPackage({
      projectPath,
      scope: 'project',
      builtArtifacts: ['dist/route.js'],
      tmpRoot,
    })
    const outsideFilePath = path.join(tmpRoot, 'outside-route.js')
    await writeText(outsideFilePath, 'export const escaped = true\n')
    await fs.rm(path.join(extensionPackage.packagePath, 'dist', 'route.js'))
    await fs.symlink(outsideFilePath, path.join(extensionPackage.packagePath, 'dist', 'route.js'))

    registerExtensionRuntimeProtocolOnce(allowRuntimeModuleAccess())

    const escapedUrl = runtimeModuleUrl({
      packagePath: extensionPackage.packagePath,
      contentHash: extensionPackage.contentHash,
      relativePath: 'dist/route.js',
    })

    expect((await dispatchProtocolRequest(escapedUrl)).status).toBe(HTTP_NOT_FOUND_STATUS)
    expect(protocolMocks.networkFetch.fetch).not.toHaveBeenCalled()
  })

  it('rejects hash-covered runtime files when current registry policy denies access', async () => {
    const { registerExtensionRuntimeProtocolOnce } = await loadRendererProtocol()
    const projectPath = path.join(tmpRoot, 'project')
    const extensionPackage = await writeExtensionPackage({
      projectPath,
      scope: 'project',
      builtArtifacts: ['dist/route.js'],
      tmpRoot,
    })
    const access = {
      isExtensionRuntimeModuleAllowed: vi.fn(() => Promise.resolve(false)),
    }

    registerExtensionRuntimeProtocolOnce(access)

    const routeUrl = runtimeModuleUrl({
      packagePath: extensionPackage.packagePath,
      contentHash: extensionPackage.contentHash,
      relativePath: 'dist/route.js',
      projectPaths: [projectPath],
    })

    expect((await dispatchProtocolRequest(routeUrl)).status).toBe(HTTP_NOT_FOUND_STATUS)
    expect(protocolMocks.networkFetch.fetch).not.toHaveBeenCalled()
  })
})
