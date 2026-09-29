import type { BuildChannel } from '../src/shared/types/build-identity'

const NOTARIZATION_ENV = ['APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID'] as const

function present(env: NodeJS.ProcessEnv, name: string) {
  return (env[name]?.trim() ?? '') !== ''
}

/**
 * macOS signing for one build (docs/release-and-versioning.md, "Platform trust for v1").
 *
 * The release workflow provides a Developer ID certificate through `CSC_LINK` and notarization
 * credentials through `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, and `APPLE_TEAM_ID`. Dev builds and
 * builds without a certificate stay unsigned.
 *
 * This only chooses how to sign. It never fails, because every electron-builder command loads the
 * configuration, including `install-app-deps` during `pnpm install` and the unsigned nightly canary.
 * The release workflow enforces that release candidate and Stable builds are signed and notarized
 * before it builds them.
 */
export function resolveMacSigning(channel: BuildChannel, env: NodeJS.ProcessEnv = process.env) {
  const canSign = channel !== 'dev' && present(env, 'CSC_LINK')
  if (!canSign) return { identity: null }
  return { hardenedRuntime: true, notarize: NOTARIZATION_ENV.every((name) => present(env, name)) }
}
