import path from 'node:path'
import { pathToFileURL } from 'node:url'
import type { ClientIdentity } from '@earendil-works/pi-ai'
import type { SettingsManager } from '@earendil-works/pi-coding-agent'

// Pi does not export the function it builds each request's identity with (sdk.js,
// `buildRequestOptions`), so tests read it from Pi's own module, the instance Pi's package uses.
const PI_CLIENT_IDENTITY_MODULE = path.resolve(
  'node_modules/@earendil-works/pi-coding-agent/dist/core/client-identity.js',
)

/** The identity Pi gives a request of a runtime with these settings. */
export async function piRequestIdentity(settingsManager: SettingsManager): Promise<ClientIdentity> {
  const piModule: unknown = await import(pathToFileURL(PI_CLIENT_IDENTITY_MODULE).href)
  const getClientIdentity: unknown =
    typeof piModule === 'object' && piModule !== null
      ? Reflect.get(piModule, 'getClientIdentity')
      : undefined
  if (typeof getClientIdentity !== 'function') throw new Error('Pi client identity moved')
  const identity: unknown = Reflect.apply(getClientIdentity, undefined, [settingsManager])
  if (typeof identity !== 'object' || identity === null) throw new Error('No Pi client identity')
  return identity
}
