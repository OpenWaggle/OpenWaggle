import { decodeUnknownOrThrow, Schema, type SchemaType } from '@shared/schema'

const optionalUrlSchema = Schema.optional(
  Schema.String.pipe(
    Schema.filter((value) => {
      try {
        // URL constructor normalizes and validates the shape for us.
        new URL(value)
        return true
      } catch {
        return 'Must be a valid URL.'
      }
    }),
  ),
)

const envSchema = Schema.Struct({
  ELECTRON_RENDERER_URL: optionalUrlSchema,
  OPENWAGGLE_USER_DATA_DIR: Schema.optional(Schema.String),
  OPENWAGGLE_DISABLE_SINGLE_INSTANCE: Schema.optional(Schema.String),
  OPENWAGGLE_LOG_LEVEL: Schema.optional(Schema.Literal('debug', 'info', 'warn', 'error')),
})

export type Env = SchemaType<typeof envSchema>

export const env: Env = decodeUnknownOrThrow(envSchema, process.env)

export const logLevel = env.OPENWAGGLE_LOG_LEVEL ?? 'info'

/**
 * Safe environment for child processes.
 * Only passes through essential variables — prevents leaking API keys,
 * secrets, or other sensitive values from the parent process.
 */
export function getSafeChildEnv(): Record<string, string | undefined> {
  return {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    SHELL: process.env.SHELL,
    TERM: process.env.TERM,
    LANG: process.env.LANG,
    USER: process.env.USER,
    TMPDIR: process.env.TMPDIR,
  }
}

/**
 * Environment for `gh` CLI calls.
 * Strips GITHUB_TOKEN / GH_TOKEN so `gh` uses its keyring-stored OAuth
 * credentials from `gh auth login` — the standard setup for end users.
 * Inherited env tokens (e.g. from CI or dev tooling) can cause permission
 * mismatches with the target org's token policies.
 */
export function getGhCliEnv(): Record<string, string | undefined> {
  const env = { ...process.env }
  delete env.GITHUB_TOKEN
  delete env.GH_TOKEN
  return env
}
