/**
 * The narrow part of `Bun.build` the main build uses (scripts/build-main.ts), typed here because
 * the repository does not load Bun's global types: they retype `fetch` for every test.
 */
export interface BunPluginResolveArgs {
  readonly path: string
  readonly importer: string
  readonly namespace: string
  readonly kind: string
}

export interface BunPluginLoadArgs {
  readonly path: string
  readonly namespace: string
}

export interface BunPluginBuilder {
  readonly onResolve: (
    options: { readonly filter: RegExp; readonly namespace?: string },
    callback: (
      args: BunPluginResolveArgs,
    ) =>
      | { readonly path: string; readonly namespace?: string; readonly external?: boolean }
      | undefined,
  ) => void
  readonly onLoad: (
    options: { readonly filter: RegExp; readonly namespace?: string },
    callback: (args: BunPluginLoadArgs) => { readonly contents: string; readonly loader: 'js' },
  ) => void
}

export interface BunPlugin {
  readonly name: string
  readonly setup: (builder: BunPluginBuilder) => void
}

export interface BunBuildConfig {
  readonly entrypoints: readonly string[]
  readonly outdir: string
  readonly target: 'bun' | 'node'
  readonly format: 'esm' | 'cjs'
  readonly naming?: string | { readonly entry: string; readonly chunk: string }
  readonly minify?:
    | boolean
    | {
        readonly whitespace: boolean
        readonly syntax: boolean
        readonly identifiers: boolean
        readonly keepNames: boolean
      }
  readonly sourcemap?: 'none' | 'external' | 'linked' | 'inline'
  readonly define?: Readonly<Record<string, string>>
  readonly external?: readonly string[]
  readonly plugins?: readonly BunPlugin[]
  readonly metafile?: boolean
  readonly splitting?: boolean
  readonly banner?: string
}

export interface BunBuildMetafileOutput {
  readonly bytes: number
  readonly inputs: Readonly<Record<string, { readonly bytesInOutput: number }>>
  readonly imports: readonly { readonly path: string; readonly kind: string }[]
  readonly entryPoint?: string
}

export interface BunBuildOutput {
  readonly success: boolean
  readonly logs: readonly unknown[]
  readonly outputs: readonly { readonly path: string; readonly kind: string }[]
  readonly metafile?: { readonly outputs: Readonly<Record<string, BunBuildMetafileOutput>> }
}

type BunBuild = (config: BunBuildConfig) => Promise<BunBuildOutput>

function isBunWithBuild(value: unknown): value is { readonly build: BunBuild } {
  return (
    typeof value === 'object' && value !== null && typeof Reflect.get(value, 'build') === 'function'
  )
}

/** `Bun.build`, or a clear error when a script that needs it runs outside Bun. */
export function bunBuild(config: BunBuildConfig) {
  const bun: unknown = Reflect.get(globalThis, 'Bun')
  if (!isBunWithBuild(bun)) throw new Error('This build step runs on Bun: bun scripts/<name>.ts')
  return bun.build(config)
}
