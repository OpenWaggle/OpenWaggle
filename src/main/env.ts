import { createEnv } from '@t3-oss/env-core'
import { z } from 'zod'

export const env = createEnv({
  server: {
    ELECTRON_RENDERER_URL: z.string().url().optional(),
    OPENHIVE_USER_DATA_DIR: z.string().optional(),
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
