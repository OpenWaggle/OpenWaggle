import { createAgentSessionFromServices, SessionManager } from '@mariozechner/pi-coding-agent'
import { Layer } from 'effect'
import * as Effect from 'effect/Effect'
import { createLogger } from '../../logger'
import { type ProviderProbeInput, ProviderProbeService } from '../../ports/provider-probe-service'
import { createPiRuntimeServices } from './pi-provider-catalog'

const logger = createLogger('pi-provider-probe')
const PROVIDER_PROBE_PROMPT = 'Reply with exactly OK and nothing else.'
const PROVIDER_PROBE_TIMEOUT_MS = 15_000

async function runPiPromptProbe(input: ProviderProbeInput): Promise<void> {
  const cwd = input.projectPath ?? process.cwd()
  const services = await createPiRuntimeServices(cwd)
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

async function probeProviderCredentials(input: ProviderProbeInput): Promise<void> {
  await runPiPromptProbe(input)
}

export const PiProviderProbeLive = Layer.succeed(
  ProviderProbeService,
  ProviderProbeService.of({
    probeCredentials: (input) =>
      Effect.tryPromise({
        try: () => probeProviderCredentials(input),
        catch: (error) => (error instanceof Error ? error : new Error(String(error))),
      }),
  }),
)
