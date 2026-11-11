import fs from 'node:fs/promises'
import path from 'node:path'
import { electrobunAppHome } from './support/electrobun-app-launch'
import type { FixtureModelServer } from './website-screenshot-model-server'

/** The model the scripted endpoint stands in for: the one the seeded Sessions already use. */
export const FIXTURE_MODEL_REF = 'openai/gpt-5.4'
const FIXTURE_MODEL_ID = 'gpt-5.4'
const FIXTURE_CONTEXT_WINDOW = 272_000
const FIXTURE_MAX_TOKENS = 128_000
const FIXTURE_INPUT_COST = 2.5
const FIXTURE_OUTPUT_COST = 15
const FIXTURE_CACHE_READ_COST = 0.25
const PRIVATE_FILE_MODE = 0o600
const JSON_INDENT = 2

/**
 * Fake keys, so Settings > Connections shows providers with an API key configured. They never
 * leave the machine: both providers' base URLs point at the loopback endpoint (`models.json`).
 */
const FIXTURE_CREDENTIALS = {
  openai: { type: 'api_key', key: 'sk-website-fixture-openai' },
  anthropic: { type: 'api_key', key: 'sk-ant-website-fixture' },
} as const

/**
 * Writes the scratch Pi agent directory's `auth.json` and `models.json` before the app starts;
 * nothing else writes them. Both providers go to the one scripted model server, so no request
 * with a fixture key can reach a real provider:
 *
 * - `anthropic` keeps Pi's catalog (real names, 1M context windows) and only moves its base URL,
 *   so every Claude model is answered over Anthropic Messages (the Waggle captures).
 * - `openai` replaces GPT-5.4 with the same model over Chat Completions (the essentials captures).
 *   Every other OpenAI model keeps the Responses API, which the server answers with a 404, so the
 *   essentials choose GPT-5.4 as their Title model too.
 */
export async function writeFixturePiAgent(input: {
  readonly userDataDir: string
  readonly homeDir: string
  readonly model: Pick<FixtureModelServer, 'openAiBaseUrl' | 'anthropicBaseUrl'>
}) {
  const openAiBaseUrl = input.model.openAiBaseUrl
  const { piAgentDir } = electrobunAppHome(input)
  await fs.mkdir(piAgentDir, { recursive: true })
  await fs.writeFile(
    path.join(piAgentDir, 'auth.json'),
    `${JSON.stringify(FIXTURE_CREDENTIALS, null, JSON_INDENT)}\n`,
    { mode: PRIVATE_FILE_MODE },
  )
  const models = {
    providers: {
      anthropic: { baseUrl: input.model.anthropicBaseUrl },
      openai: {
        baseUrl: openAiBaseUrl,
        models: [
          {
            id: FIXTURE_MODEL_ID,
            name: 'GPT-5.4',
            api: 'openai-completions',
            baseUrl: openAiBaseUrl,
            reasoning: true,
            input: ['text', 'image'],
            contextWindow: FIXTURE_CONTEXT_WINDOW,
            maxTokens: FIXTURE_MAX_TOKENS,
            cost: {
              input: FIXTURE_INPUT_COST,
              output: FIXTURE_OUTPUT_COST,
              cacheRead: FIXTURE_CACHE_READ_COST,
              cacheWrite: 0,
            },
            compat: {
              supportsStore: false,
              supportsDeveloperRole: false,
              supportsReasoningEffort: true,
              maxTokensField: 'max_completion_tokens',
            },
          },
        ],
      },
    },
  }
  await fs.writeFile(
    path.join(piAgentDir, 'models.json'),
    `${JSON.stringify(models, null, JSON_INDENT)}\n`,
  )
}
