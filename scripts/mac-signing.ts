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
 * builds without a certificate stay unsigned. Release candidate and Stable builds fail closed unless
 * they are both signed and notarized, so the RC validation window exercises the same signing
 * pipeline Stable ships with. macOS artifacts are only built on macOS, so the requirement is
 * enforced there and not on the Linux and Windows release jobs that load the same configuration.
 */
export function resolveMacSigning(
  channel: BuildChannel,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
) {
  const canSign = channel !== 'dev' && present(env, 'CSC_LINK')
  const canNotarize = canSign && NOTARIZATION_ENV.every((name) => present(env, name))
  if (platform === 'darwin' && (channel === 'rc' || channel === 'stable') && !canNotarize) {
    throw new Error(
      `${channel === 'rc' ? 'Release candidate' : 'Stable'} macOS builds must be signed and notarized. ` +
        `Provide CSC_LINK, CSC_KEY_PASSWORD, and ${NOTARIZATION_ENV.join(', ')}.`,
    )
  }
  if (!canSign) return { identity: null }
  return { hardenedRuntime: true, notarize: canNotarize }
}
