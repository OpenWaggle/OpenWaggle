import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { BrowserEngineStatus } from '@shared/types/browser-engine'
import { describe, expect, it, vi } from 'vitest'
import { temporaryTestDirectory } from '../../../../test-support/temporary-test-directory'
import { createCefComponentEngine } from '../cef-component-engine'
import { CEF_FRAMEWORK_BINARY } from '../cef-component-files'
import type { CefComponentInstallerDependencies } from '../cef-component-installer'
import { decodeCefComponentManifest, type CefComponentManifest } from '../cef-component-manifest'
import committedManifest from '../manifest.json'

const CEF_VERSION = '156.0.7+g47dbc1d+chromium-156.0.8078.17'
const ROOT_NAME = `${CEF_VERSION}-arm64`
const HELPER = path.join('bun Helper.app', 'Contents', 'MacOS', 'bun Helper')
const ARCHIVE = Buffer.from('a fake CEF component archive, long enough for several chunks')
const CHUNK = 16

function sha256(data: Uint8Array) {
  return createHash('sha256').update(data).digest('hex')
}

function manifestFor(data: Uint8Array, size = data.byteLength) {
  const asset = { url: 'https://downloads.test/cef.tar.xz', sha256: sha256(data), size }
  return {
    schemaVersion: 1,
    cefVersion: CEF_VERSION,
    assets: { 'darwin-arm64': asset, 'darwin-x64': asset },
  } satisfies CefComponentManifest
}

function streamed(data: Uint8Array) {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (let offset = 0; offset < data.byteLength; offset += CHUNK) {
          controller.enqueue(data.subarray(offset, offset + CHUNK))
        }
        controller.close()
      },
    }),
  )
}

/** `tar` as a process boundary: it writes the component's files into the staging directory. */
async function extractComponent(_archive: string, destination: string) {
  await fs.mkdir(path.join(destination, path.dirname(CEF_FRAMEWORK_BINARY)), { recursive: true })
  await fs.writeFile(path.join(destination, CEF_FRAMEWORK_BINARY), 'framework')
  await fs.mkdir(path.join(destination, path.dirname(HELPER)), { recursive: true })
  await fs.writeFile(path.join(destination, HELPER), 'helper', { mode: 0o755 })
}

async function harness(overrides: Partial<CefComponentInstallerDependencies> = {}) {
  const home = await temporaryTestDirectory('cef-component-')
  const directory = path.join(home, 'ai.openwaggle.test', 'cef')
  const fetch = vi.fn(async (_url: string) => streamed(ARCHIVE))
  const engine = createCefComponentEngine({
    platform: 'darwin',
    arch: 'arm64',
    manifest: () => manifestFor(ARCHIVE),
    bundledFramework: path.join(home, 'bundle', 'Frameworks', CEF_FRAMEWORK_BINARY),
    componentsDirectory: async () => directory,
    fetch,
    extract: extractComponent,
    ...overrides,
  })
  const statuses: BrowserEngineStatus[] = []
  engine.onStatus((status) => statuses.push(status))
  return { home, directory, root: path.join(directory, ROOT_NAME), fetch, engine, statuses }
}

async function record(root: string) {
  return JSON.parse(await fs.readFile(path.join(root, 'component.json'), 'utf8'))
}

const entries = (directory: string) => fs.readdir(directory).catch(() => [])

describe('CEF component installer', () => {
  it('decodes the committed manifest', () => {
    expect(decodeCefComponentManifest(committedManifest).cefVersion).toBe(CEF_VERSION)
  })

  it('is ready off macOS and when the app bundle carries CEF, without a download', async () => {
    const elsewhere = await harness({ platform: 'linux' })
    expect(elsewhere.engine.status()).toEqual({ type: 'ready' })
    await expect(elsewhere.engine.ensure()).resolves.toEqual({ type: 'ready' })

    const bundled = await harness()
    const framework = path.join(bundled.home, 'bundle', 'Frameworks', CEF_FRAMEWORK_BINARY)
    await fs.mkdir(path.dirname(framework), { recursive: true })
    await fs.writeFile(framework, 'framework')
    await expect(bundled.engine.ensure()).resolves.toEqual({ type: 'ready' })
    expect([elsewhere.fetch, bundled.fetch].flatMap((fetch) => fetch.mock.calls)).toEqual([])
  })

  it('downloads, verifies and installs the pinned component, reporting progress', async () => {
    const { engine, fetch, root, directory, statuses } = await harness()
    const [first, second] = [engine.ensure(), engine.ensure()]

    await expect(first).resolves.toEqual({ type: 'ready' })
    await expect(second).resolves.toEqual({ type: 'ready' })
    expect(fetch).toHaveBeenCalledOnce()
    const downloads = statuses.filter((status) => status.type === 'downloading')
    const totalBytes = ARCHIVE.byteLength
    expect(downloads[0]).toEqual({ type: 'downloading', receivedBytes: 0, totalBytes })
    expect(downloads.at(-1)).toEqual({ type: 'downloading', receivedBytes: totalBytes, totalBytes })
    expect(downloads.length).toBeGreaterThan(2)
    expect(statuses.map((status) => status.type).filter((type) => type !== 'downloading')).toEqual([
      'checking',
      'installing',
      'ready',
    ])
    expect(await record(root)).toEqual({
      schemaVersion: 1,
      cefVersion: CEF_VERSION,
      arch: 'arm64',
      sha256: sha256(ARCHIVE),
    })
    expect(await entries(directory)).toEqual([ROOT_NAME])
  })

  it('keeps a current component and prunes other versions and leftover temporaries', async () => {
    const first = await harness()
    await first.engine.ensure()
    for (const leftover of ['155.0.1-arm64', '.download-1', '.staging-2', '.old-3']) {
      await fs.mkdir(path.join(first.directory, leftover))
    }
    const again = await harness({ componentsDirectory: async () => first.directory })

    await expect(again.engine.ensure()).resolves.toEqual({ type: 'ready' })
    expect(again.fetch).not.toHaveBeenCalled()
    expect(await entries(first.directory)).toEqual([ROOT_NAME])
  })

  it('replaces the installed component when the pinned one changes', async () => {
    const first = await harness()
    await first.engine.ensure()
    const next = Buffer.from('the next pinned CEF component archive')
    const updated = await harness({
      componentsDirectory: async () => first.directory,
      manifest: () => manifestFor(next),
      fetch: async () => streamed(next),
    })

    await expect(updated.engine.ensure()).resolves.toEqual({ type: 'ready' })
    expect(await record(first.root)).toMatchObject({ sha256: sha256(next) })
    expect(await entries(first.directory)).toEqual([ROOT_NAME])
  })

  it.each([
    [
      'a checksum mismatch',
      { manifest: () => manifestFor(Buffer.from('other bytes!'), ARCHIVE.byteLength) },
    ],
    ['a shorter download', { manifest: () => manifestFor(ARCHIVE, ARCHIVE.byteLength + 1) }],
    ['a longer download', { manifest: () => manifestFor(ARCHIVE, ARCHIVE.byteLength - 1) }],
  ])('fails closed on %s and leaves nothing behind', async (_case, overrides) => {
    const { engine, directory } = await harness(overrides)
    await expect(engine.ensure()).resolves.toMatchObject({ type: 'failed', reason: 'integrity' })
    expect(await entries(directory)).toEqual([])
  })

  it.each<[string, Partial<CefComponentInstallerDependencies>, string]>([
    ['offline', { fetch: () => Promise.reject(new TypeError('fetch failed')) }, 'offline'],
    [
      'dropped the connection',
      {
        fetch: async () =>
          new Response(
            new ReadableStream({
              start: (controller) => controller.error(new Error('socket hang up')),
            }),
          ),
      },
      'offline',
    ],
    [
      'stalled',
      {
        stallMs: 20,
        fetch: async () =>
          new Response(new ReadableStream({ pull: () => new Promise(() => undefined) })),
      },
      'offline',
    ],
    [
      'never answered',
      { stallMs: 20, fetch: () => new Promise<Response>(() => undefined) },
      'offline',
    ],
    ['answered 404', { fetch: async () => new Response('missing', { status: 404 }) }, 'http'],
    ['failed to extract', { extract: () => Promise.reject(new Error('tar: bad')) }, 'install'],
    [
      'extracted no helper',
      {
        extract: async (_archive, destination) => {
          await fs.mkdir(path.join(destination, path.dirname(CEF_FRAMEWORK_BINARY)))
          await fs.writeFile(path.join(destination, CEF_FRAMEWORK_BINARY), 'framework')
        },
      },
      'install',
    ],
  ])(
    'reports the failure when the server or archive %s, and cleans up',
    async (_c, deps, reason) => {
      const { engine, directory } = await harness(deps)
      await expect(engine.ensure()).resolves.toMatchObject({ type: 'failed', reason })
      expect(await entries(directory)).toEqual([])
    },
  )

  it('retries after a failure on the next ensure', async () => {
    const fetch = vi
      .fn<(url: string) => Promise<Response>>()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockImplementation(async () => streamed(ARCHIVE))
    const { engine } = await harness({ fetch })

    await expect(engine.ensure()).resolves.toMatchObject({ type: 'failed', reason: 'offline' })
    await expect(engine.ensure()).resolves.toEqual({ type: 'ready' })
  })
})
