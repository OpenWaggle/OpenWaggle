import { execFileSync } from 'node:child_process'
import path from 'node:path'
import type { BuildChannel } from '../src/shared/types/build-identity'

/**
 * Build-time Build identity resolver (see docs/adr/0032). One rule, consumed by
 * electron-vite (bakes runtime constants), electron-builder (packaging name /
 * appId / icon), and the runtime (dev-build userData isolation). Never hand-set
 * per build.
 *
 * Scope (see ADR 0032): released channels (stable/alpha/beta/rc) share the
 * canonical app identity — same appId, executable, and userData — and differ
 * only in display name and icon. Only `dev` builds get a distinct, isolated
 * identity, because that is the incident this exists to prevent (a stale local
 * build acting on the installed release's data). Coexisting *release* channels
 * with separate appIds/userData is deferred: it needs an install-base migration
 * and, for GitHub releases, per-channel update feeds that the provider does not
 * currently emit.
 */

const RELEASE_CHANNEL_ENV = 'OPENWAGGLE_RELEASE_CHANNEL'
const DEV_SLUG_ENV = 'OPENWAGGLE_DEV_SLUG'
const SLUG_MAX_LENGTH = 40

/** The canonical released app identity. All release channels use it. */
export const CANONICAL_APP_ID = 'com.openwaggle.app'
/** Stable across every channel so packaged binary/bundle names never change. */
export const CANONICAL_EXECUTABLE_NAME = 'OpenWaggle'

const RELEASE_DISPLAY_NAME: Record<Exclude<BuildChannel, 'dev'>, string> = {
  stable: 'OpenWaggle',
  alpha: 'OpenWaggle Alpha',
  beta: 'OpenWaggle Beta',
  rc: 'OpenWaggle RC',
}

export interface ResolvedBuildIdentity {
  readonly channel: BuildChannel
  /** Source provenance for dev builds; null for released channels. */
  readonly slug: string | null
  /** Display name (CFBundleName / window title / About). */
  readonly productName: string
  readonly appId: string
  /** Only dev builds isolate userData (via app.setName); releases share it. */
  readonly isolateUserData: boolean
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
  if (channel === 'dev') {
    const slug = resolveDevSlug(env, cwd)
    return {
      channel,
      slug,
      productName: `OpenWaggle Dev · ${slug}`,
      appId: `com.openwaggle.dev.${slug}`,
      isolateUserData: true,
    }
  }
  return {
    channel,
    slug: null,
    productName: RELEASE_DISPLAY_NAME[channel],
    appId: CANONICAL_APP_ID,
    isolateUserData: false,
  }
}

/**
 * Icon path for a channel, relative to the repo `build/` directory. Stable keeps
 * the hand-authored platform icons; other channels use a committed variant that
 * wears a labelled ribbon so builds are distinguishable at a glance. POSIX
 * separators: this value is an electron-builder config path.
 */
export function resolveIconBasePath(channel: BuildChannel, buildResourcesDir: string): string {
  const file = channel === 'stable' ? 'icon.png' : `icon-${channel}.png`
  return path.posix.join(buildResourcesDir, file)
}
