import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  createProvider,
  type FauxResponseStep,
  fauxProvider,
  InMemoryCredentialStore,
} from '@earendil-works/pi-ai'
import {
  createAgentSession,
  DefaultResourceLoader,
  type ExtensionFactory,
  ModelRuntime,
  type SessionCompactEvent,
  SessionManager,
  SettingsManager,
} from '@earendil-works/pi-coding-agent'
import { vi } from 'vitest'
import { makeCompactResponse } from './pi-native-compaction-test-fixtures'

const tempDirectories: string[] = []
const sessions: Array<{ dispose: () => void }> = []

export function createNativeTempDirectory(label: string) {
  const directory = mkdtempSync(path.join(tmpdir(), label))
  tempDirectories.push(directory)
  return directory
}

export async function createNativeSession(options: {
  directory: string
  compactionEvents: SessionCompactEvent[]
  authBaseUrl?: string
  authBaseUrlState?: { value: string | undefined }
  authBaseUrlResolver?: () => string | undefined
  authFailureState?: { shouldFail: boolean }
  providerReloadState?: {
    baseUrl: string | undefined
    supportsCompaction?: boolean
    executed?: boolean
  }
  responses?: FauxResponseStep[]
}) {
  const faux = fauxProvider({
    api: 'openai-responses',
    provider: 'native-provider',
    models: [{ id: 'native-model', contextWindow: 100, maxTokens: 20 }],
  })
  const nativeModel = {
    ...faux.getModel(),
    compat: { supportsCompaction: true },
  }
  if (options.responses) faux.setResponses(options.responses)
  const modelRuntime = await ModelRuntime.create({
    credentials: new InMemoryCredentialStore(),
    refreshOnCreate: false,
  })
  const nativeProvider = {
    ...faux.provider,
    auth: {
      apiKey: {
        name: 'Native test key',
        async check() {
          return { type: 'api_key' as const, source: 'test' }
        },
        async resolve() {
          if (options.authFailureState?.shouldFail) throw new Error('Credentials unavailable')
          return {
            auth: {
              apiKey: 'test-key',
              baseUrl: options.authBaseUrlResolver
                ? options.authBaseUrlResolver()
                : (options.authBaseUrlState?.value ?? options.authBaseUrl),
            },
            source: 'test',
          }
        },
      },
    },
  }
  modelRuntime.registerNativeProvider(nativeProvider)
  const settingsManager = SettingsManager.inMemory({
    retry: { enabled: false },
    compaction: {
      enabled: true,
      thresholdPercent: 80,
      keepRecentTokens: 1,
      reserveTokens: 20,
    },
  })
  const extension: ExtensionFactory = (pi) => {
    pi.on('session_compact', (event) => {
      options.compactionEvents.push(event)
    })
    if (options.providerReloadState) {
      pi.registerCommand('reload-native-provider', {
        description: 'Reload the native provider fixture',
        handler: async () => {
          if (options.providerReloadState) options.providerReloadState.executed = true
          const baseUrl = options.providerReloadState?.baseUrl
          const supportsCompaction = options.providerReloadState?.supportsCompaction
          if (!baseUrl && supportsCompaction === undefined) return
          const reloadedModels = nativeProvider.getModels().map((model) => ({
            ...model,
            baseUrl: baseUrl ?? model.baseUrl,
            compat: {
              ...model.compat,
              supportsCompaction: supportsCompaction ?? true,
            },
          }))
          pi.registerProvider(
            createProvider({
              id: nativeProvider.id,
              name: nativeProvider.name,
              auth: nativeProvider.auth,
              models: reloadedModels,
              api: {
                stream: (model, context, streamOptions) =>
                  nativeProvider.stream(model, context, streamOptions),
                streamSimple: (model, context, streamOptions) =>
                  nativeProvider.streamSimple(model, context, streamOptions),
              },
            }),
          )
        },
      })
    }
  }
  const resourceLoader = new DefaultResourceLoader({
    cwd: options.directory,
    agentDir: options.directory,
    settingsManager,
    extensionFactories: [extension],
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
  })
  await resourceLoader.reload()
  const sessionManager = SessionManager.inMemory(options.directory)
  sessionManager.appendMessage({ role: 'user', content: 'Initial context', timestamp: 1 })
  const result = await createAgentSession({
    cwd: options.directory,
    agentDir: options.directory,
    model: nativeModel,
    modelRuntime,
    resourceLoader,
    sessionManager,
    settingsManager,
    noTools: 'all',
  })
  sessions.push(result.session)
  return { ...result, faux, modelRuntime }
}

export function nativeCompactionFetch(requestBodies?: string[], failFrom?: number) {
  let checkpoint = 0
  return vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
    if (typeof init?.body === 'string') requestBodies?.push(init.body)
    checkpoint += 1
    if (failFrom !== undefined && checkpoint >= failFrom) {
      throw new Error('Compaction endpoint unavailable')
    }
    return makeCompactResponse([
      { type: 'compaction', id: `cmp_${checkpoint}`, encrypted_content: `opaque-${checkpoint}` },
    ])
  })
}

export function checkpointIds(events: SessionCompactEvent[]) {
  return events.map((event) => {
    const details = event.compactionEntry.details
    if (
      typeof details !== 'object' ||
      details === null ||
      !('items' in details) ||
      !Array.isArray(details.items)
    ) {
      return undefined
    }
    const checkpoint = details.items.at(-1)
    if (
      typeof checkpoint !== 'object' ||
      checkpoint === null ||
      !('id' in checkpoint) ||
      typeof checkpoint.id !== 'string'
    ) {
      return undefined
    }
    return checkpoint.id
  })
}

export function cleanupNativeSessions() {
  vi.unstubAllGlobals()
  while (sessions.length > 0) sessions.pop()?.dispose()
  while (tempDirectories.length > 0) {
    const directory = tempDirectories.pop()
    if (directory) rmSync(directory, { recursive: true, force: true })
  }
}
