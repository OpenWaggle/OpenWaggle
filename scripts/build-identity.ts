import { execFileSync } from 'node:child_process'
import path from 'node:path'
import type { BuildChannel } from '../src/shared/types/build-identity'

/**
 * Build-time Build identity resolver (see docs/adr/0032). One rule, run by
 * electron-vite (bakes runtime constants), electron-builder (packaging name /
 * appId / icon), and record-build-meta (provenance). Never hand-set per build.
 */

const RELEASE_CHANNEL_ENV = 'OPENWAGGLE_RELEASE_CHANNEL'
const DEV_SLUG_ENV = 'OPENWAGGLE_DEV_SLUG'
const SLUG_MAX_LENGTH = 40

export interface ResolvedBuildIdentity {
  readonly channel: BuildChannel
  /** Source provenance for dev builds; null for released channels. */
  readonly slug: string | null
  readonly productName: string
  readonly appId: string
}

/**
 * Provenance-gated: only an explicit release-workflow signal yields a non-dev
 * channel. Anything else is `dev`, so a local or worktree build can never
 * masquerade as a release.
 */
export function resolveBuildChannel(env: NodeJS.ProcessEnv = process.env): BuildChannel {
  const raw = env[RELEASE_CHANNEL_ENV]?.trim().toLowerCase()
  if (raw === 'stable' || raw === 'alpha' || raw === 'beta' || raw === 'rc') return raw
  return 'dev'
}

function sanitizeSlug(value: string) {
  const cleaned = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX_LENGTH)
    .replace(/-+$/g, '')
  return cleaned || 'local'
}

/** Dev provenance slug: explicit override, else the git branch, else `local`. */
export function resolveDevSlug(
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd(),
): string {
  const explicit = env[DEV_SLUG_ENV]?.trim()
  if (explicit) return sanitizeSlug(explicit)
  try {
    const branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd,
      encoding: 'utf8',
    }).trim()
    if (branch && branch !== 'HEAD') return sanitizeSlug(branch)
  } catch {
    // Not a git checkout (e.g. an unpacked tarball); fall back to `local`.
  }
  return 'local'
}

export function resolveBuildIdentity(
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd(),
): ResolvedBuildIdentity {
  const channel = resolveBuildChannel(env)
  if (channel === 'stable') {
    return {
      channel,
      slug: null,
      productName: 'OpenWaggle',
      appId: 'com.openwaggle.app',
    }
  }
  if (channel === 'dev') {
    const slug = resolveDevSlug(env, cwd)
    return {
      channel,
      slug,
      productName: `OpenWaggle Dev · ${slug}`,
      appId: `com.openwaggle.dev.${slug}`,
    }
  }
  const label = channel === 'alpha' ? 'Alpha' : channel === 'beta' ? 'Beta' : 'RC'
  return {
    channel,
    slug: null,
    productName: `OpenWaggle ${label}`,
    appId: `com.openwaggle.${channel}`,
  }
}

/**
 * Icon path for a channel, relative to the repo `build/` directory. Stable keeps
 * the hand-authored platform icons; other channels use a committed variant that
 * wears a labelled ribbon so builds are distinguishable at a glance.
 */
export function resolveIconBasePath(channel: BuildChannel, buildResourcesDir: string): string {
  const file = channel === 'stable' ? 'icon.png' : `icon-${channel}.png`
  return path.join(buildResourcesDir, file)
}
