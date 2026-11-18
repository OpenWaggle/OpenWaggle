/**
 * The deadline for a `beforeAll` that imports a large module graph the first time. Component hooks
 * keep Vitest's 10 s default, which a cold import alone exceeded on a loaded machine. A deadline is
 * a ceiling, not a wait. Keep the import out of `beforeEach`, so only the file pays for it, once
 * (`scripts/test-support/cold-import-hooks.ts` checks this).
 */
export const COLD_IMPORT_TIMEOUT_MS = 60_000
