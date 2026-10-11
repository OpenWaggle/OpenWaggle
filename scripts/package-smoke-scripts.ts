/** The scripts of each package consumer smoke project. */
export const SMOKE_PROJECT_SCRIPTS = {
  typecheck: 'tsc -p tsconfig.json --noEmit',
  'import:cjs': 'tsx require-smoke.ts',
  // A settled Waggle turn of pi-waggle's default extension, from its CommonJS build.
  'waggle-turn:cjs': 'node require-waggle-turn-smoke.cjs',
  'import:esm': 'tsx import-smoke.ts',
  'browser:bundle': 'vite build --config vite.config.ts',
  'pi:discovery': 'tsx pi-discovery-smoke.ts',
} as const

/** Run in order in each consumer project, up to and including the browser bundle. */
export const SMOKE_SCRIPTS_BEFORE_BROWSER = [
  'typecheck',
  'import:esm',
  'import:cjs',
  'waggle-turn:cjs',
  'browser:bundle',
] as const satisfies readonly (keyof typeof SMOKE_PROJECT_SCRIPTS)[]
