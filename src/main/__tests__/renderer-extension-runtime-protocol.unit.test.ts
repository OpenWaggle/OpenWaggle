import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runtimeModuleUrl, writeExtensionPackage, writeText } from './renderer-protocol-test-utils'

const HTTP_NOT_FOUND_STATUS = 404

interface ProtocolRequest {
  readonly url: string
}

type ProtocolHandler = (request: ProtocolRequest) => Response | Promise<Response>

const protocolMocks = vi.hoisted(() => {
  const protocolHandlers = new Map<string, ProtocolHandler>()
  return {
    is: { dev: false },
    env: { ELECTRON_RENDERER_URL: '' },
    app: { getPath: vi.fn(() => '/tmp/user-data') },
    existsSync: vi.fn(),
    fetch: vi.fn((url: string) => Promise.resolve(new Response(url))),
    registerSchemesAsPrivileged: vi.fn(),
    handle: vi.fn((scheme: string, handler: ProtocolHandler) => {
      protocolHandlers.set(scheme, handler)
    }),
    getProtocolHandler: (scheme: string) => protocolHandlers.get(scheme) ?? null,
    resetHandler: () => {
      protocolHandlers.clear()
    },
  }
})

vi.mock('node:fs', () => ({
  existsSync: protocolMocks.existsSync,
}))

vi.mock('@electron-toolkit/utils', () => ({
  is: protocolMocks.is,
}))

vi.mock('electron', () => ({
  app: protocolMocks.app,
  net: {
    fetch: protocolMocks.fetch,
  },
  protocol: {
    registerSchemesAsPrivileged: protocolMocks.registerSchemesAsPrivileged,
    handle: protocolMocks.handle,
  },
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

function dispatchProtocolRequest(scheme: string, url: string) {
  const handler = protocolMocks.getProtocolHandler(scheme)
  if (!handler) throw new Error('Expected protocol handler')
  return handler({ url })
}

describe('extension runtime protocol', () => {
  beforeEach(async () => {
    vi.resetModules()
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-runtime-protocol-'))
    protocolMocks.is.dev = false
    protocolMocks.env.ELECTRON_RENDERER_URL = ''
    protocolMocks.app.getPath.mockReturnValue(path.join(tmpRoot, 'user-data'))
    protocolMocks.fetch.mockClear()
    protocolMocks.handle.mockClear()
    protocolMocks.resetHandler()
  })

  afterEach(async () => {
    if (tmpRoot) {
      await fs.rm(tmpRoot, { recursive: true, force: true })
      tmpRoot = ''
    }
  })

  it('serves hash-covered runtime entries and relative chunks from project packages', async () => {
    const { EXTENSION_RUNTIME_PROTOCOL, registerExtensionRuntimeProtocolOnce } =
      await loadRendererProtocol()
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

    const routeResponse = await dispatchProtocolRequest(EXTENSION_RUNTIME_PROTOCOL, routeUrl)
    expect(routeResponse.headers.get('access-control-allow-origin')).toBe('*')
    expect(await routeResponse.text()).toContain('dist/route.js')
    expect(
      await (await dispatchProtocolRequest(EXTENSION_RUNTIME_PROTOCOL, chunkUrl)).text(),
    ).toContain('dist/chunk.js')
    expect(access.isExtensionRuntimeModuleAllowed).toHaveBeenCalledWith({
      packagePath: extensionPackage.packagePath,
      contentHash: extensionPackage.contentHash,
      projectPaths: [projectPath],
    })
  })

  it('serves hash-covered runtime entries from global extension packages', async () => {
    const { EXTENSION_RUNTIME_PROTOCOL, registerExtensionRuntimeProtocolOnce } =
      await loadRendererProtocol()
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

    expect(
      await (await dispatchProtocolRequest(EXTENSION_RUNTIME_PROTOCOL, routeUrl)).text(),
    ).toContain('dist/route.js')
  })

  it('rejects stale hashes and package files outside the manifest hash input', async () => {
    const { EXTENSION_RUNTIME_PROTOCOL, registerExtensionRuntimeProtocolOnce } =
      await loadRendererProtocol()
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

    const staleHashUrl = runtimeModuleUrl({
      packagePath: extensionPackage.packagePath,
      contentHash: 'stale-hash',
      relativePath: 'dist/route.js',
    })
    const undeclaredUrl = runtimeModuleUrl({
      packagePath: extensionPackage.packagePath,
      contentHash: extensionPackage.contentHash,
      relativePath: 'dist/undeclared.js',
    })

    expect((await dispatchProtocolRequest(EXTENSION_RUNTIME_PROTOCOL, staleHashUrl)).status).toBe(
      HTTP_NOT_FOUND_STATUS,
    )
    expect((await dispatchProtocolRequest(EXTENSION_RUNTIME_PROTOCOL, undeclaredUrl)).status).toBe(
      HTTP_NOT_FOUND_STATUS,
    )
  })

  it('rejects hash-covered runtime files that resolve outside the extension package', async () => {
    const { EXTENSION_RUNTIME_PROTOCOL, registerExtensionRuntimeProtocolOnce } =
      await loadRendererProtocol()
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

    expect((await dispatchProtocolRequest(EXTENSION_RUNTIME_PROTOCOL, escapedUrl)).status).toBe(
      HTTP_NOT_FOUND_STATUS,
    )
    expect(protocolMocks.fetch).not.toHaveBeenCalled()
  })

  it('rejects extension runtime module requests outside extension package roots', async () => {
    const { EXTENSION_RUNTIME_PROTOCOL, registerExtensionRuntimeProtocolOnce } =
      await loadRendererProtocol()
    const projectPath = path.join(tmpRoot, 'project')
    const extensionPackage = await writeExtensionPackage({
      projectPath,
      scope: 'project',
      builtArtifacts: ['dist/route.js'],
      tmpRoot,
    })

    registerExtensionRuntimeProtocolOnce(allowRuntimeModuleAccess())

    const traversalUrl = runtimeModuleUrl({
      packagePath: extensionPackage.packagePath,
      contentHash: extensionPackage.contentHash,
      relativePath: '%2e%2e/secret.js',
    })
    const outsideExtensionUrl = runtimeModuleUrl({
      packagePath: path.join(projectPath, 'not-an-extension'),
      contentHash: extensionPackage.contentHash,
      relativePath: 'dist/route.js',
    })

    expect((await dispatchProtocolRequest(EXTENSION_RUNTIME_PROTOCOL, traversalUrl)).status).toBe(
      HTTP_NOT_FOUND_STATUS,
    )
    expect(
      (await dispatchProtocolRequest(EXTENSION_RUNTIME_PROTOCOL, outsideExtensionUrl)).status,
    ).toBe(HTTP_NOT_FOUND_STATUS)
  })

  it('rejects hash-covered runtime files when current registry policy denies access', async () => {
    const { EXTENSION_RUNTIME_PROTOCOL, registerExtensionRuntimeProtocolOnce } =
      await loadRendererProtocol()
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

    expect((await dispatchProtocolRequest(EXTENSION_RUNTIME_PROTOCOL, routeUrl)).status).toBe(
      HTTP_NOT_FOUND_STATUS,
    )
    expect(protocolMocks.fetch).not.toHaveBeenCalled()
  })
})
