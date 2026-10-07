import { createHash } from 'node:crypto'
import { access, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import JSZip from 'jszip'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { installVerifiedMcpb } from '../registry-mcpb'
import { createDockerOciImageResolver } from '../registry-oci-resolver'
import { fetchBoundedRegistryResource } from '../registry-secure-download'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  )
})

async function temporaryDirectory() {
  const directory = await mkdtemp(path.join(tmpdir(), 'openwaggle-registry-integrity-'))
  temporaryDirectories.push(directory)
  return directory
}

async function archiveWith(extra: (zip: JSZip) => void) {
  const zip = new JSZip()
  zip.file(
    'manifest.json',
    JSON.stringify({
      manifest_version: '0.3',
      name: 'archive-security',
      version: '1.0.0',
      description: 'Archive security test.',
      author: { name: 'OpenWaggle tests' },
      server: { type: 'node', entry_point: 'server/index.js' },
    }),
  )
  zip.file('server/index.js', 'process.stdin.resume()\n')
  extra(zip)
  return zip.generateAsync({ type: 'nodebuffer', platform: 'UNIX' })
}

async function expectRejectedArchive(archive: Buffer, message: string) {
  const root = await temporaryDirectory()
  const sha256 = createHash('sha256').update(archive).digest('hex')
  await expect(
    installVerifiedMcpb({
      identifier: 'https://github.com/example/security-mcp/releases/download/v1/security.mcpb',
      expectedSha256: sha256,
      cacheRoot: root,
      homeDir: '/test/home',
      fetchResource: async () => new Response(new Uint8Array(archive)),
    }),
  ).rejects.toThrow(message)
  await expect(access(path.join(root, 'mcpb', sha256))).rejects.toThrow()
}

describe('MCP Registry integrity boundaries', () => {
  it('rejects ZIP path traversal before any package is cached', async () => {
    await expectRejectedArchive(
      await archiveWith((zip) => zip.file('../escaped.txt', 'escape')),
      'unsafe path',
    )
  })

  it('rejects ZIP symbolic links before any package is cached', async () => {
    await expectRejectedArchive(
      await archiveWith((zip) =>
        zip.file('server/link', 'index.js', { unixPermissions: 0o120777 }),
      ),
      'symbolic link',
    )
  })

  it('rejects an oversized response from Content-Length before reading it', async () => {
    const fetchResource = vi.fn(
      async () =>
        new Response(new Uint8Array(), {
          headers: { 'content-length': '101' },
        }),
    )
    await expect(
      fetchBoundedRegistryResource({
        url: new URL('https://registry.modelcontextprotocol.io/v0.1/servers'),
        limitBytes: 100,
        timeoutMs: 1_000,
        accept: 'application/json',
        fetchResource,
      }),
    ).rejects.toThrow('safety limit')
  })

  it('pulls and inspects a tagged OCI image before returning its digest coordinate', async () => {
    const digest = `sha256:${'c'.repeat(64)}`
    const runCommand = vi
      .fn<(args: readonly string[]) => Promise<string>>()
      .mockResolvedValueOnce('')
      .mockResolvedValueOnce(JSON.stringify([`ghcr.io/example/server@${digest}`]))
    const resolve = createDockerOciImageResolver(runCommand)

    await expect(resolve('ghcr.io/example/server:v1')).resolves.toEqual({
      coordinate: `ghcr.io/example/server@${digest}`,
      digest,
    })
    expect(runCommand).toHaveBeenNthCalledWith(1, ['pull', '--quiet', 'ghcr.io/example/server:v1'])
    expect(runCommand).toHaveBeenNthCalledWith(2, [
      'image',
      'inspect',
      '--format={{json .RepoDigests}}',
      'ghcr.io/example/server:v1',
    ])
  })

  it('does not trust a declared OCI digest that Docker did not verify', async () => {
    const declared = `sha256:${'d'.repeat(64)}`
    const different = `sha256:${'e'.repeat(64)}`
    const resolve = createDockerOciImageResolver(
      vi
        .fn<(args: readonly string[]) => Promise<string>>()
        .mockResolvedValueOnce('')
        .mockResolvedValueOnce(JSON.stringify([`ghcr.io/example/server@${different}`])),
    )

    await expect(resolve(`ghcr.io/example/server@${declared}`)).rejects.toThrow('could not prove')
  })
})
