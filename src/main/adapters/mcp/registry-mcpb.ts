import { createHash } from 'node:crypto'
import { chmod, lstat, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { extractMcpbArchive } from './registry-mcpb-archive'
import { loadMcpbLauncher, type McpbCachedLauncher } from './registry-mcpb-manifest'
import {
  fetchBoundedRegistryResource,
  type RegistryResourceFetcher,
} from './registry-secure-download'

const MCPB_DOWNLOAD_LIMIT_BYTES = 100 * 1_024 * 1_024
const MCPB_DOWNLOAD_TIMEOUT_MS = 60_000
const SHA256_PATTERN = /^[a-f0-9]{64}$/
const INTEGRITY_FILE = '.openwaggle-mcpb-integrity.json'
const CACHE_DIRECTORY_MODE = 0o700
const CACHE_FILE_MODE = 0o600
const ARTIFACT_REDIRECT_DOMAINS = [
  'objects.githubusercontent.com',
  'release-assets.githubusercontent.com',
  'github-releases.githubusercontent.com',
] as const

export interface InstalledMcpbLauncher extends McpbCachedLauncher {
  readonly cwd: string
  readonly coordinate: string
  readonly digest: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function nodeErrorCode(value: unknown) {
  return isRecord(value) && typeof value.code === 'string' ? value.code : undefined
}

function validateArtifactUrl(identifier: string) {
  const url = new URL(identifier)
  const githubRelease =
    url.hostname === 'github.com' && url.pathname.includes('/releases/download/')
  const gitlabRelease =
    url.hostname === 'gitlab.com' &&
    url.pathname.includes('/-/releases/') &&
    url.pathname.includes('/downloads/')
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.hash ||
    (!githubRelease && !gitlabRelease) ||
    !url.pathname.toLowerCase().includes('mcp')
  ) {
    throw new Error('MCPB packages require an HTTPS GitHub or GitLab MCP release URL.')
  }
  return url
}

async function validateCachedPackage(input: {
  readonly root: string
  readonly expectedSha256: string
  readonly homeDir: string
  readonly platform: NodeJS.Platform
}) {
  const rootMetadata = await lstat(input.root)
  if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink()) {
    throw new Error('Verified MCPB cache entry is not a regular directory.')
  }
  const marker: unknown = JSON.parse(await readFile(path.join(input.root, INTEGRITY_FILE), 'utf8'))
  if (!isRecord(marker) || marker.sha256 !== input.expectedSha256 || marker.schemaVersion !== 1) {
    throw new Error('Verified MCPB cache entry failed its integrity marker check.')
  }
  return loadMcpbLauncher({
    root: input.root,
    homeDir: input.homeDir,
    platform: input.platform,
  })
}

function installedLauncher(input: {
  readonly launcher: McpbCachedLauncher
  readonly root: string
  readonly url: URL
  readonly sha256: string
}): InstalledMcpbLauncher {
  return {
    ...input.launcher,
    cwd: input.root,
    coordinate: `mcpb:${input.url.href}#sha256=${input.sha256}`,
    digest: `sha256:${input.sha256}`,
  }
}

async function cachedLauncher(input: {
  readonly root: string
  readonly expectedSha256: string
  readonly homeDir: string
  readonly platform: NodeJS.Platform
  readonly url: URL
}) {
  const launcher = await validateCachedPackage(input)
  return installedLauncher({
    launcher,
    root: input.root,
    url: input.url,
    sha256: input.expectedSha256,
  })
}

export async function installVerifiedMcpb(input: {
  readonly identifier: string
  readonly expectedSha256: string
  readonly cacheRoot: string
  readonly homeDir: string
  readonly platform?: NodeJS.Platform
  readonly fetchResource?: RegistryResourceFetcher
}): Promise<InstalledMcpbLauncher> {
  if (!SHA256_PATTERN.test(input.expectedSha256)) {
    throw new Error('MCPB registry entry requires a lowercase SHA-256 file hash.')
  }
  const url = validateArtifactUrl(input.identifier)
  const archive = await fetchBoundedRegistryResource({
    url,
    limitBytes: MCPB_DOWNLOAD_LIMIT_BYTES,
    timeoutMs: MCPB_DOWNLOAD_TIMEOUT_MS,
    accept: 'application/octet-stream',
    allowedDomains: ARTIFACT_REDIRECT_DOMAINS,
    ...(input.fetchResource ? { fetchResource: input.fetchResource } : {}),
  })
  const actualSha256 = createHash('sha256').update(archive).digest('hex')
  if (actualSha256 !== input.expectedSha256) {
    throw new Error(
      'MCPB artifact SHA-256 did not match the Registry metadata; nothing was installed.',
    )
  }

  const platform = input.platform ?? process.platform
  const cacheBase = path.join(input.cacheRoot, 'mcpb')
  const finalRoot = path.join(cacheBase, actualSha256)
  await mkdir(cacheBase, { recursive: true, mode: CACHE_DIRECTORY_MODE })
  await chmod(cacheBase, CACHE_DIRECTORY_MODE)
  try {
    return await cachedLauncher({
      root: finalRoot,
      expectedSha256: actualSha256,
      homeDir: input.homeDir,
      platform,
      url,
    })
  } catch (error) {
    if (nodeErrorCode(error) !== 'ENOENT') throw error
  }

  const stagingRoot = await mkdtemp(path.join(cacheBase, `.install-${actualSha256}-`))
  try {
    await extractMcpbArchive(archive, stagingRoot)
    await loadMcpbLauncher({ root: stagingRoot, homeDir: input.homeDir, platform })
    await writeFile(
      path.join(stagingRoot, INTEGRITY_FILE),
      `${JSON.stringify({ schemaVersion: 1, sha256: actualSha256 })}\n`,
      { encoding: 'utf8', flag: 'wx', mode: CACHE_FILE_MODE },
    )
    try {
      await rename(stagingRoot, finalRoot)
    } catch (error) {
      if (nodeErrorCode(error) !== 'EEXIST' && nodeErrorCode(error) !== 'ENOTEMPTY') throw error
    }
    return await cachedLauncher({
      root: finalRoot,
      expectedSha256: actualSha256,
      homeDir: input.homeDir,
      platform,
      url,
    })
  } finally {
    await rm(stagingRoot, { force: true, recursive: true })
  }
}
