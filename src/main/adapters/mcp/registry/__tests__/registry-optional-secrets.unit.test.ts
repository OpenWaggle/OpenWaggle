import { describe, expect, it } from 'vitest'
import type { RegistryServerRecord } from '../registry-client'
import { createRegistryEntry } from '../registry-entry'

const DIGEST = `sha256:${'a'.repeat(64)}`

/** R3's Registry probe: an OCI image with a required and an optional env secret, and a flag. */
function weatherImage(): RegistryServerRecord {
  const pkg = {
    registryType: 'oci',
    identifier: 'ghcr.io/acme/weather:1.0.0',
    transport: { type: 'stdio' },
    environmentVariables: [
      { name: 'WEATHER_API_KEY', isSecret: true, isRequired: true },
      { name: 'PREMIUM_TOKEN', isSecret: true },
    ],
    packageArguments: [{ type: 'named', name: '--license-key', isSecret: true }],
  }
  return {
    name: 'io.github.acme/weather',
    version: '1.0.0',
    raw: { name: 'io.github.acme/weather', version: '1.0.0', packages: [pkg] },
  }
}

describe('optional Registry secrets', () => {
  it('lists optional secret arguments apart, and says a container needs -e for an env secret', async () => {
    const result = await createRegistryEntry(weatherImage(), {
      method: 'oci',
      cacheRoot: '/unused-cache',
      homeDir: '/home/me',
      resolveOciImage: async () => ({
        digest: DIGEST,
        coordinate: `ghcr.io/acme/weather@${DIGEST}`,
      }),
    })

    expect(result).toMatchObject({
      entry: {
        args: ['run', '--rm', '-i', '-e', 'WEATHER_API_KEY', `ghcr.io/acme/weather@${DIGEST}`],
      },
      secrets: ['WEATHER_API_KEY'],
      optionalSecrets: ['PREMIUM_TOKEN'],
      optionalSecretArguments: ['--license-key'],
      optionalSecretsNeedContainerEnv: true,
    })
  })
})
