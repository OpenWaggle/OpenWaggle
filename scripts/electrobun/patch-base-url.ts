/**
 * The base URL Hutch builds a delta patch against (scripts/electrobun/app-config.ts,
 * OPENWAGGLE_ELECTROBUN_PATCH_BASE_URL): the download directory of the newest published release
 * older than `<version>` that already ships Electrobun's update files for this target. Electrobun's
 * updater asks the release it updates to for `<prefix>-<installed hash>.patch`, so a release carries
 * the patch from the one before it; installs further behind download the full archive. Prints
 * nothing when no earlier release has Electrobun update files (the first Electrobun release).
 *
 *   bun scripts/electrobun/patch-base-url.ts <version> <macos|win|linux> <arm64|x64>
 *
 * Reads GitHub's release list, with GITHUB_TOKEN when set.
 */
import { pathToFileURL } from 'node:url'
import { compareReleaseVersions } from '../../src/main/update-feed'
import { isRecord } from '../../src/shared/utils/validation'
import { RELEASE_DOWNLOAD_BASE } from './app-config'

const FIRST_CLI_ARGUMENT = 2
const RELEASES_URL = 'https://api.github.com/repos/OpenWaggle/OpenWaggle/releases?per_page=100'

export interface ListedRelease {
  readonly tag: string
  readonly draft: boolean
  readonly assets: readonly string[]
}

function listedRelease(value: unknown) {
  if (!isRecord(value) || typeof value.tag_name !== 'string') return null
  const assets = Array.isArray(value.assets) ? value.assets : []
  return {
    tag: value.tag_name,
    draft: value.draft === true,
    assets: assets.flatMap((asset: unknown) =>
      isRecord(asset) && typeof asset.name === 'string' ? [asset.name] : [],
    ),
  }
}

/** The newest earlier release with this target's Electrobun update manifest, or null. */
export function patchBaseRelease(
  releases: readonly ListedRelease[],
  version: string,
  target: string,
) {
  const manifest = `stable-${target}-update-v2.json`
  const earlier = releases.filter((release) => {
    const order = compareReleaseVersions(release.tag, version)
    return !release.draft && order !== undefined && order < 0 && release.assets.includes(manifest)
  })
  earlier.sort((left, right) => compareReleaseVersions(right.tag, left.tag) ?? 0)
  return earlier[0] ?? null
}

async function main(argv: readonly string[]) {
  const [version, os, arch] = argv
  if (version === undefined || os === undefined || arch === undefined) {
    throw new Error('Usage: patch-base-url.ts <version> <macos|win|linux> <arm64|x64>')
  }
  const token = process.env.GITHUB_TOKEN ?? ''
  const response = await fetch(RELEASES_URL, {
    headers: {
      accept: 'application/vnd.github+json',
      ...(token === '' ? {} : { authorization: `Bearer ${token}` }),
    },
  })
  if (!response.ok) throw new Error(`Listing releases failed with HTTP ${response.status}.`)
  const body: unknown = await response.json()
  const releases = (Array.isArray(body) ? body : []).flatMap((entry: unknown) => {
    const release = listedRelease(entry)
    return release === null ? [] : [release]
  })
  const base = patchBaseRelease(releases, version, `${os}-${arch}`)
  if (base !== null) console.log(`${RELEASE_DOWNLOAD_BASE}/${encodeURIComponent(base.tag)}`)
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(FIRST_CLI_ARGUMENT)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  })
}
