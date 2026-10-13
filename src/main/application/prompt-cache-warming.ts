import type { PromptCacheWarming } from '../ports/prompt-cache-warming'

const NO_PROMPT_CACHE_WARMING: PromptCacheWarming = {
  applyMode: () => undefined,
  closeSession: () => undefined,
  reopenSession: () => undefined,
  forgetSession: () => undefined,
  start: () => undefined,
  stop: async () => undefined,
}

let current = NO_PROMPT_CACHE_WARMING

/** Installed by the Host's composition root. Returns the function that removes it. */
export function installPromptCacheWarming(service: PromptCacheWarming) {
  current = service
  return () => {
    if (current === service) current = NO_PROMPT_CACHE_WARMING
  }
}

/** The Host's prompt cache warming, or one that does nothing before it is installed. */
export function promptCacheWarming(): PromptCacheWarming {
  return current
}
