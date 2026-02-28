import { createEnv } from '@t3-oss/env-core'
import { z } from 'zod'

export const env = createEnv({
  server: {
    ELECTRON_RENDERER_URL: z.string().url().optional(),
    OPENWAGGLE_USER_DATA_DIR: z.string().optional(),
  },
  runtimeEnv: process.env,
})

/**
 * Safe environment for child processes (e.g. runCommand tool).
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
 * Full process environment with undefined values filtered out.
 * Used by MCP stdio transports that need to inherit the parent environment.
 */
export function getFullProcessEnv(): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === 'string') {
      result[key] = value
    }
  }
  return result
}
