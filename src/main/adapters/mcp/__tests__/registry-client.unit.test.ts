import { createHash } from 'node:crypto'
import { access, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import JSZip from 'jszip'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createRegistryDraft,
  type McpRegistryPackageType,
  type McpRegistryServer,
  mcpRegistryPackageType,
} from '../registry-client'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  )
})

async function temporaryDirectory() {
  const directory = await mkdtemp(path.join(tmpdir(), 'openwaggle-registry-test-'))
  temporaryDirectories.push(directory)
  return directory
}

function registryServer(packageEntry: Readonly<Record<string, unknown>>): McpRegistryServer {
  return {
    name: 'io.github.example/server',
    title: 'Example server',
    version: '2.0.0',
    raw: {
      name: 'io.github.example/server',
      version: '2.0.0',
      packages: [packageEntry],
    },
  }
}

function packageEntry(registryType: McpRegistryPackageType, identifier: string, version?: string) {
  return {
    registryType,
    identifier,
    ...(version ? { version } : {}),
    transport: { type: 'stdio' },
  }
}

async function nodeMcpbArchive(extra?: (zip: JSZip) => void) {
  const zip = new JSZip()
  zip.file(
    'manifest.json',
    JSON.stringify({
      manifest_version: '0.3',
      name: 'verified-bundle',
      version: '1.2.3',
      description: 'A verified test MCPB.',
      author: { name: 'OpenWaggle tests' },
      server: {
        type: 'node',
        entry_point: 'server/index.js',
        mcp_config: {
          command: 'node',
          args: [`\${__dirname}/server/index.js`],
          env: { BUNDLE_HOME: `\${HOME}` },
        },
      },
    }),
  )
  zip.file('server/index.js', 'process.stdin.resume()\n')
  extra?.(zip)
  return zip.generateAsync({ type: 'nodebuffer', platform: 'UNIX' })
}

describe('MCP Registry package launchers', () => {
  it('recognizes mcpb as an explicit CLI-selectable Registry package type', () => {
    expect(mcpRegistryPackageType('mcpb')).toBe('mcpb')
    expect(mcpRegistryPackageType('mutable-tarball')).toBeUndefined()
  })

  it.each([
    ['npm', '@example/server', '1.2.3', 'npx', 'npm:@example/server@1.2.3'],
    ['pypi', 'example-server', '1.2.3.post1', 'uvx', 'pypi:example-server==1.2.3.post1'],
    ['nuget', 'Example.Server', '1.2.3', 'dnx', 'nuget:Example.Server@1.2.3'],
  ] as const)('pins %s to an exact package coordinate without claiming a verified digest', async (registryType, identifier, version, command, coordinate) => {
    const draft = await createRegistryDraft({
      server: registryServer(packageEntry(registryType, identifier, version)),
    })

    expect(draft.definition.command).toBe(command)
    expect(draft.definition.provenance).toMatchObject({ packageCoordinate: coordinate })
    expect(draft.definition.provenance).not.toHaveProperty('packageDigest')
  })

  it('rejects mutable package-manager versions', async () => {
    await expect(
      createRegistryDraft({
        server: registryServer(packageEntry('npm', '@example/server', '^1.2.3')),
      }),
    ).rejects.toThrow('exact immutable version')
  })

  it('accepts an OCI entry without package version and records only the resolved digest', async () => {
    const digest = `sha256:${'a'.repeat(64)}`
    const resolveOciImage = vi.fn(async () => ({
      coordinate: `ghcr.io/example/server@${digest}`,
      digest,
    }))
    const draft = await createRegistryDraft({
      server: registryServer({
        ...packageEntry('oci', 'ghcr.io/example/server:v2'),
        digest: `sha256:${'b'.repeat(64)}`,
      }),
      resolveOciImage,
    })

    expect(resolveOciImage).toHaveBeenCalledWith('ghcr.io/example/server:v2')
    expect(draft.definition.args).toContain(`ghcr.io/example/server@${digest}`)
    expect(draft.definition.provenance).toMatchObject({
      packageCoordinate: `oci:ghcr.io/example/server@${digest}`,
      packageDigest: digest,
    })
  })

  it('installs a versionless MCPB only after verifying its bytes and manifest', async () => {
    const root = await temporaryDirectory()
    const archive = await nodeMcpbArchive()
    const sha256 = createHash('sha256').update(archive).digest('hex')
    const fetchResource = vi.fn(async () => new Response(new Uint8Array(archive)))
    const identifier =
      'https://github.com/example/example-mcp/releases/download/v1.2.3/example.mcpb'

    const draft = await createRegistryDraft({
      server: registryServer({
        ...packageEntry('mcpb', identifier),
        fileSha256: sha256,
      }),
      cacheRoot: root,
      homeDir: '/test/home',
      fetchResource,
    })

    expect(draft.definition.command).toBe('node')
    expect(draft.definition.cwd).toBe(path.join(root, 'mcpb', sha256))
    expect(draft.definition.args).toEqual([path.join(root, 'mcpb', sha256, 'server', 'index.js')])
    expect(draft.definition.env).toEqual({ BUNDLE_HOME: '/test/home' })
    expect(draft.definition.provenance).toMatchObject({
      packageCoordinate: `mcpb:${identifier}#sha256=${sha256}`,
      packageDigest: `sha256:${sha256}`,
    })
    const marker = JSON.parse(
      await readFile(path.join(root, 'mcpb', sha256, '.openwaggle-mcpb-integrity.json'), 'utf8'),
    )
    expect(marker).toEqual({ schemaVersion: 1, sha256 })
  })

  it('does not create a cache or provenance when MCPB bytes fail SHA-256 verification', async () => {
    const root = await temporaryDirectory()
    const archive = await nodeMcpbArchive()
    await expect(
      createRegistryDraft({
        server: registryServer({
          ...packageEntry(
            'mcpb',
            'https://github.com/example/example-mcp/releases/download/v1/example.mcpb',
          ),
          fileSha256: '0'.repeat(64),
        }),
        cacheRoot: root,
        homeDir: '/test/home',
        fetchResource: async () => new Response(new Uint8Array(archive)),
      }),
    ).rejects.toThrow('nothing was installed')
    await expect(access(path.join(root, 'mcpb'))).rejects.toThrow()
  })
})
