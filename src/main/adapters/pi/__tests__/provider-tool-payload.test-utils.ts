import { isMatching, P } from '@diegogbrisa/ts-match'
import { stream as streamBedrock } from '@earendil-works/pi-ai/api/bedrock-converse-stream'
import { stream as streamOpenAiCompletions } from '@earendil-works/pi-ai/api/openai-completions'
import { AMAZON_BEDROCK_MODELS } from '@earendil-works/pi-ai/providers/amazon-bedrock.models'
import { OPENROUTER_MODELS } from '@earendil-works/pi-ai/providers/openrouter.models'
import { normalizeContext } from '@earendil-works/pi-ai/utils/transcript'
import type { ToolDefinition } from '@earendil-works/pi-coding-agent'

/** The models QA used when the providers rejected OpenWaggle's tool schemas. */
const BEDROCK_MODEL = AMAZON_BEDROCK_MODELS['eu.anthropic.claude-haiku-4-5-20251001-v1:0']
const OPENROUTER_OPENAI_MODEL = OPENROUTER_MODELS['openai/gpt-4.1']

class PayloadCaptured extends Error {}

export interface ProviderToolPayloads {
  /** `toolConfig.tools[i].toolSpec.inputSchema.json` exactly as Bedrock Converse would receive it. */
  readonly bedrock: ReadonlyMap<string, unknown>
  /** `tools[i].function.parameters` exactly as an OpenAI-compatible endpoint would receive it. */
  readonly openai: ReadonlyMap<string, unknown>
}

function context(tools: readonly ToolDefinition[]) {
  return normalizeContext({
    systemPrompt: 'Schema probe.',
    messages: [{ role: 'user', content: 'probe', timestamp: 0 }],
    tools: tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    })),
  })
}

async function capture(
  run: (onPayload: (payload: unknown) => never) => {
    result(): Promise<{ readonly errorMessage?: string }>
  },
): Promise<unknown> {
  let captured: unknown
  const result = await run((payload) => {
    // Round-trip like the SDKs do on the wire, which also drops TypeBox's symbol keys.
    captured = JSON.parse(JSON.stringify(payload))
    throw new PayloadCaptured('payload captured before any network request')
  }).result()
  if (captured === undefined) {
    throw new Error(`Pi failed before building the payload: ${result.errorMessage ?? 'unknown'}`)
  }
  return captured
}

function toolsByName(entries: readonly unknown[], pick: (entry: unknown) => [string, unknown]) {
  return new Map(entries.map(pick))
}

/**
 * Feeds tools through the same request builders Pi uses for Amazon Bedrock and for OpenAI models
 * reached through OpenRouter, and returns the tool parameter schemas each provider would receive.
 * `onPayload` throws, so no request leaves the process.
 */
export async function providerToolPayloads(
  tools: readonly ToolDefinition[],
): Promise<ProviderToolPayloads> {
  const bedrockPayload = await capture((onPayload) =>
    streamBedrock(BEDROCK_MODEL, context(tools), {
      region: 'eu-west-1',
      env: { AWS_BEDROCK_SKIP_AUTH: '1' },
      maxRetries: 0,
      onPayload,
    }),
  )
  const openAiPayload = await capture((onPayload) =>
    streamOpenAiCompletions(OPENROUTER_OPENAI_MODEL, context(tools), {
      apiKey: 'probe-key',
      maxRetries: 0,
      onPayload,
    }),
  )
  if (!isMatching({ toolConfig: { tools: P.array(P._) } }, bedrockPayload)) {
    throw new Error('Bedrock payload has no toolConfig.tools')
  }
  if (!isMatching({ tools: P.array(P._) }, openAiPayload)) {
    throw new Error('OpenAI payload has no tools')
  }
  return {
    bedrock: toolsByName(bedrockPayload.toolConfig.tools, (entry) => {
      if (!isMatching({ toolSpec: { name: P.string, inputSchema: { json: P._ } } }, entry)) {
        throw new Error('Unexpected Bedrock tool entry')
      }
      return [entry.toolSpec.name, entry.toolSpec.inputSchema.json]
    }),
    openai: toolsByName(openAiPayload.tools, (entry) => {
      if (!isMatching({ function: { name: P.string, parameters: P._ } }, entry)) {
        throw new Error('Unexpected OpenAI tool entry')
      }
      return [entry.function.name, entry.function.parameters]
    }),
  }
}
