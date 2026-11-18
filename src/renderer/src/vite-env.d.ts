/// <reference types="vite/client" />

/*
 * Vite client ambient types (import.meta.env, asset modules). The `export {}` marker is
 * required: TypeScript 7 drops ambient-only declaration files that contribute nothing,
 * which would silently remove the vite/client reference from the web program.
 */
export {}
