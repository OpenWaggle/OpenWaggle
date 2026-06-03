import {
  type AgentSessionServices,
  createAgentSessionFromServices,
  SessionManager,
} from '@mariozechner/pi-coding-agent'
import { Layer } from 'effect'
import * as Effect from 'effect/Effect'
import { loadWithRuntimeFailureIsolation } from '../../extensions/runtime-load-isolation'
import { createLogger } from '../../logger'
import { ExtensionLifecycleRepository } from '../../ports/extension-lifecycle-repository'
import { ExtensionManagerService } from '../../ports/extension-manager-service'
import { ExtensionProjectOverridesRepository } from '../../ports/extension-project-overrides-repository'
import { type ProviderProbeInput, ProviderProbeService } from '../../ports/provider-probe-service'
import {
  listRuntimeEnabledPackages,
  type OpenWagglePiExtensionSelectionServices,
} from './openwaggle-pi-extension-selection'
import { recordRuntimeLoadFailure } from './openwaggle-pi-runtime-failure-recording'
import { createPiRuntimeServices } from './pi-provider-catalog'
import {
  getPiRuntimeExtensionLoadErrors,
  rejectMatchingOpenWaggleExtensionLoadErrors,
} from './pi-runtime-extension-load-errors'

const logger = createLogger('pi-provider-probe')
const PROVIDER_PROBE_PROMPT = 'Reply with exactly OK and nothing else.'
const PROVIDER_PROBE_TIMEOUT_MS = 15_000

async function runPiPromptProbe(input: ProviderProbeInput, services: AgentSessionServices) {
  if (input.apiKey) {
    services.authStorage.setRuntimeApiKey(input.providerId, input.apiKey)
  }

  const model = services.modelRegistry.find(input.providerId, input.modelId)
  if (!model) {
    throw new Error(`Unknown provider/model: ${input.providerId}/${input.modelId}`)
  }

  const { session } = await createAgentSessionFromServices({
    services,
    model,
    sessionManager: SessionManager.inMemory(),
    noTools: 'all',
  })

  let timeoutId: ReturnType<typeof setTimeout> | null = null
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeoutId = setTimeout(() => {
      void session.abort().catch((error) => {
        logger.warn('Failed to abort provider probe session after timeout', {
          error: error instanceof Error ? error.message : String(error),
          providerId: input.providerId,
          modelId: input.modelId,
        })
      })
      reject(new Error('Provider test timed out'))
    }, PROVIDER_PROBE_TIMEOUT_MS)
  })

  try {
    await Promise.race([
      session.prompt(PROVIDER_PROBE_PROMPT, { expandPromptTemplates: false }),
      timeoutPromise,
    ])
  } finally {
    if (timeoutId !== null) {
      clearTimeout(timeoutId)
    }
    session.dispose()
  }
}

async function createProbeRuntimeServices(
  input: ProviderProbeInput,
  enabledOpenWaggleExtensionPackagePaths: readonly string[],
) {
  const cwd = input.projectPath ?? process.cwd()
  const services = await createPiRuntimeServices(cwd, {
    enabledOpenWaggleExtensionPackagePaths,
    loadMcpAdapter: false,
  })
  return rejectMatchingOpenWaggleExtensionLoadErrors({
    result: services,
    errors: getPiRuntimeExtensionLoadErrors(services),
    enabledOpenWaggleExtensionPackagePaths,
  })
}

function loadEnabledOpenWaggleExtensionPackages(
  projectPath: string | null | undefined,
  extensionSelectionServices: OpenWagglePiExtensionSelectionServices,
) {
  return projectPath
    ? listRuntimeEnabledPackages(projectPath, extensionSelectionServices).pipe(
        Effect.catchAll((error) =>
          Effect.sync(() => {
            logger.warn('Failed to resolve OpenWaggle extension runtime allowlist', {
              projectPath,
              error: error instanceof Error ? error.message : String(error),
            })
            return []
          }),
        ),
      )
    : Effect.succeed([])
}

export const PiProviderProbeLive = Layer.effect(
  ProviderProbeService,
  Effect.gen(function* () {
    const extensionSelectionServices = {
      manager: yield* ExtensionManagerService,
      lifecycleRepository: yield* ExtensionLifecycleRepository,
      projectOverridesRepository: yield* ExtensionProjectOverridesRepository,
    } satisfies OpenWagglePiExtensionSelectionServices

    return ProviderProbeService.of({
      probeCredentials: (input) =>
        Effect.gen(function* () {
          const enabledOpenWaggleExtensionPackages = yield* loadEnabledOpenWaggleExtensionPackages(
            input.projectPath,
            extensionSelectionServices,
          )
          return yield* Effect.tryPromise({
            try: async () => {
              const services = await loadWithRuntimeFailureIsolation({
                selections: enabledOpenWaggleExtensionPackages,
                load: (enabledOpenWaggleExtensionPackagePaths) =>
                  createProbeRuntimeServices(input, enabledOpenWaggleExtensionPackagePaths),
                recordFailure: (selection, error) =>
                  recordRuntimeLoadFailure({
                    selection,
                    error,
                    extensionSelectionServices,
                    logger,
                    operation: 'Pi provider probe',
                  }),
              })
              await runPiPromptProbe(input, services)
            },
            catch: (error) => (error instanceof Error ? error : new Error(String(error))),
          })
        }),
    })
  }),
)
