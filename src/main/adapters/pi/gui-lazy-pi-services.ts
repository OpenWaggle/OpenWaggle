/**
 * The desktop window's Pi-backed ports, loaded on first use (A-F5). The window signs in to
 * providers itself (Settings > Connections) and reads the Pi Session-tree preferences, but it
 * never builds a Pi runtime: each port loads its Pi adapter the first time a method runs, so
 * startup evaluates and builds none of Pi.
 */
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import {
  ProviderAuthService,
  type ProviderAuthServiceShape,
} from '../../ports/provider-auth-service'
import {
  ProviderOAuthService,
  type ProviderOAuthServiceShape,
} from '../../ports/provider-oauth-service'
import {
  SessionTreePreferencesService,
  type SessionTreePreferencesServiceShape,
} from '../../ports/session-tree-preferences-service'

/** Builds a dependency-free layer once and keeps its service. */
function lazyService<I, S>(
  tag: Context.Tag<I, S>,
  load: () => Promise<Layer.Layer<I>>,
): Effect.Effect<S> {
  let loaded: Promise<S> | null = null
  return Effect.promise(() => {
    loaded ??= load().then((layer) =>
      Effect.runPromise(Effect.scoped(Effect.map(Layer.build(layer), Context.get(tag)))),
    )
    return loaded
  })
}

const oauth = lazyService(ProviderOAuthService, async () => {
  const { PiProviderOAuthLive } = await import('./pi-provider-oauth-service')
  return PiProviderOAuthLive
})

const apiKeys = lazyService(ProviderAuthService, async () => {
  const { PiProviderAuthLive } = await import('./pi-provider-auth-service')
  return PiProviderAuthLive
})

const treePreferences = lazyService(SessionTreePreferencesService, async () => {
  const { PiSessionTreePreferencesLive } = await import('./pi-session-tree-preferences-service')
  return PiSessionTreePreferencesLive
})

export const LazyPiProviderOAuthLive = Layer.succeed(ProviderOAuthService, {
  listProviders: () => Effect.flatMap(oauth, (service) => service.listProviders()),
  login: (provider, handlers) =>
    Effect.flatMap(oauth, (service) => service.login(provider, handlers)),
  logout: (provider) => Effect.flatMap(oauth, (service) => service.logout(provider)),
  isConnected: (provider) => Effect.flatMap(oauth, (service) => service.isConnected(provider)),
  getAccountInfo: (provider) =>
    Effect.flatMap(oauth, (service) => service.getAccountInfo(provider)),
} satisfies ProviderOAuthServiceShape)

export const LazyPiProviderAuthLive = Layer.succeed(ProviderAuthService, {
  setApiKey: (providerId, apiKey) =>
    Effect.flatMap(apiKeys, (service) => service.setApiKey(providerId, apiKey)),
} satisfies ProviderAuthServiceShape)

export const LazyPiSessionTreePreferencesLive = Layer.succeed(SessionTreePreferencesService, {
  getTreeFilterMode: (projectPath) =>
    Effect.flatMap(treePreferences, (service) => service.getTreeFilterMode(projectPath)),
  setTreeFilterMode: (mode, projectPath) =>
    Effect.flatMap(treePreferences, (service) => service.setTreeFilterMode(mode, projectPath)),
  getBranchSummarySkipPrompt: (projectPath) =>
    Effect.flatMap(treePreferences, (service) => service.getBranchSummarySkipPrompt(projectPath)),
} satisfies SessionTreePreferencesServiceShape)
