import { registerBunOAuthFlows } from '@earendil-works/pi-ai/bun-oauth'

let registered = false

/**
 * Pi normally lazy-loads Node-only OAuth flows from its package directory.
 * OpenWaggle bundles the main process, so register Pi's static flow loaders
 * before constructing a ModelRuntime instead of resolving relative to the bundle.
 */
export function registerPiBundledOAuthFlows() {
  if (registered) {
    return
  }

  registerBunOAuthFlows()
  registered = true
}
