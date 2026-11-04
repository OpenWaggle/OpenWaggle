import fs from 'node:fs/promises'
import path from 'node:path'
import { playwrightElectronHome } from './playwright-electron-launcher'

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
 * Writes the scratch Pi agent directory's `auth.json` and `models.json` before the app starts.
 * `models.json` replaces OpenAI's GPT-5.4 with the same model served over Chat Completions by the
 * scripted endpoint at `modelBaseUrl`, and sends every other OpenAI and Anthropic model there too,
 * where it fails, so no request with a fixture key can reach a real provider (the automatic Title
 * model picks a cheaper OpenAI model unless the capture chooses GPT-5.4).
 */
export async function writeFixturePiAgent(input: {
  readonly userDataDir: string
  readonly homeDir: string
  readonly modelBaseUrl: string
}) {
  const { piAgentDir } = playwrightElectronHome(input)
  await fs.mkdir(piAgentDir, { recursive: true })
  await fs.writeFile(
    path.join(piAgentDir, 'auth.json'),
    `${JSON.stringify(FIXTURE_CREDENTIALS, null, JSON_INDENT)}\n`,
    { mode: PRIVATE_FILE_MODE },
  )
  const models = {
    providers: {
      anthropic: { baseUrl: input.modelBaseUrl },
      openai: {
        baseUrl: input.modelBaseUrl,
        models: [
          {
            id: FIXTURE_MODEL_ID,
            name: 'GPT-5.4',
            api: 'openai-completions',
            baseUrl: input.modelBaseUrl,
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
