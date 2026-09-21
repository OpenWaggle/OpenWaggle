import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const RESOLUTION_START = '# BEGIN TESTABLE RELEASE RESOLUTION'
const RESOLUTION_END = '# END TESTABLE RELEASE RESOLUTION'

function releaseResolution(source: string) {
  const start = source.indexOf(RESOLUTION_START)
  const end = source.indexOf(RESOLUTION_END)
  if (start < 0 || end <= start) throw new Error('Installer release resolution was not found.')
  return source.slice(start + RESOLUTION_START.length, end)
}

async function resolveRelease(
  source: string,
  operation: 'default-channel' | 'tag',
  releases: unknown,
  channel?: 'stable' | 'beta' | 'alpha',
) {
  const script = `${releaseResolution(source)}
case "$1" in
  default-channel) resolve_default_channel "$2" ;;
  tag) resolve_release_tag "$2" "$3" ;;
esac`
  const result = await execFileAsync('bash', [
    '-c',
    script,
    'installer-release-test',
    operation,
    JSON.stringify(releases),
    channel ?? '',
  ])
  return result.stdout.trim()
}

async function resolveDefaultAcrossPages(source: string, pages: readonly unknown[]) {
  const script = `set -euo pipefail
${releaseResolution(source)}
page_one="$1"
page_two="$2"
curl() {
  case "$*" in
    *'&page=1') printf '%s' "$page_one" ;;
    *'&page=2') printf '%s' "$page_two" ;;
    *) return 1 ;;
  esac
}
resolve_default_channel "$(fetch_release_pages https://example.test/releases)"`
  const result = await execFileAsync('bash', [
    '-c',
    script,
    'installer-pagination-test',
    JSON.stringify(pages[0] ?? []),
    JSON.stringify(pages[1] ?? []),
  ])
  return result.stdout.trim()
}

describe('quick installer update channel', () => {
  it('defaults to Alpha before the first stable release and Stable afterwards', async () => {
    const source = await fs.readFile('scripts/install.sh', 'utf8')
    const prereleases = [
      { tag_name: 'v0.4.0-alpha.3', prerelease: true },
      { tag_name: 'v0.3.0-alpha.71', prerelease: false },
    ]
    const withStable = [{ tag_name: 'v0.4.0', prerelease: false }, ...prereleases]

    await expect(resolveRelease(source, 'default-channel', prereleases)).resolves.toBe('alpha')
    await expect(resolveRelease(source, 'default-channel', withStable)).resolves.toBe('stable')
  })

  it('selects the newest eligible release for each explicit channel', async () => {
    const source = await fs.readFile('scripts/install.sh', 'utf8')
    const releases = [
      { tag_name: 'v0.4.1' },
      { tag_name: 'v0.4.0' },
      { tag_name: 'v0.5.0-alpha.2' },
      { tag_name: 'v0.5.0-beta.1' },
    ]

    await expect(resolveRelease(source, 'tag', releases, 'stable')).resolves.toBe('v0.4.1')
    await expect(resolveRelease(source, 'tag', releases, 'beta')).resolves.toBe('v0.5.0-beta.1')
    await expect(resolveRelease(source, 'tag', releases, 'alpha')).resolves.toBe('v0.5.0-beta.1')
  })

  it('keeps RC releases out of automatic channels', async () => {
    const source = await fs.readFile('scripts/install.sh', 'utf8')
    const releases = [{ tag_name: 'v0.5.0-rc.1' }, { tag_name: 'v0.4.0' }]

    await expect(resolveRelease(source, 'tag', releases, 'beta')).resolves.toBe('v0.4.0')
    await expect(resolveRelease(source, 'tag', releases, 'alpha')).resolves.toBe('v0.4.0')
  })

  it('searches later GitHub pages before deciding that no Stable release exists', async () => {
    const source = await fs.readFile('scripts/install.sh', 'utf8')
    const firstPage = Array.from({ length: 100 }, (_, index) => ({
      tag_name: `v0.5.0-alpha.${100 - index}`,
    }))
    const secondPage = [{ tag_name: 'v0.4.0' }]

    await expect(resolveDefaultAcrossPages(source, [firstPage, secondPage])).resolves.toBe('stable')
  })

  it('accepts an empty page after exactly 100 releases', async () => {
    const source = await fs.readFile('scripts/install.sh', 'utf8')
    const firstPage = Array.from({ length: 100 }, (_, index) => ({
      tag_name: `v0.5.0-alpha.${100 - index}`,
    }))

    await expect(resolveDefaultAcrossPages(source, [firstPage, []])).resolves.toBe('alpha')
  })
})
