import { ModelRuntime } from '@earendil-works/pi-coding-agent'
import { registerPiBundledOAuthFlows } from './pi-bundled-oauth'

/**
 * Every OpenWaggle `ModelRuntime.create()`. Pi resolves an OAuth provider's flow (anthropic,
 * openai-codex, openai-chatgpt, …) through a bundler-opaque import next to the main bundle unless
 * its bundled loaders are registered first, and a provider's lazy flow keeps that first failure.
 * The Host registers them when its runtime loads, but the desktop window builds no Host runtime
 * (A-F5): it reaches Pi only through adapters like this one, so the registration lives here.
 */
export function createPiModelRuntime() {
  registerPiBundledOAuthFlows()
  return ModelRuntime.create()
}
