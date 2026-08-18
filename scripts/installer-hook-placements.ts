/**
 * Where electron-builder inserts each customisation hook.
 *
 * The compile check has to exercise every hook the script defines, in the place and pass that
 * electron-builder inserts it, or it only guards the hooks someone happened to hardcode. That was
 * the case: the harness inserted `customInstall` and `customUnInstall` and nothing else, so any
 * other hook - `customHeader`, `customUnInit`, `customRemoveFiles`, ... - could contain an
 * undeclared StrFunc call or outright nonsense and still pass `pnpm check` before dying in
 * `makensis` during a release. That is exactly the failure this check exists to move left.
 *
 * Anything not listed here fails the check rather than being skipped, so adding a hook forces this
 * map to be extended.
 */
export type HookPlacement =
  /** Inserted at top level in both passes (electron-builder does this outside any BUILD_UNINSTALLER guard). */
  | 'top-level'
  /** Inserted inside the installer's install section. */
  | 'install-section'
  /** Inserted inside the uninstaller's uninstall section, in the BUILD_UNINSTALLER pass. */
  | 'uninstall-section'

/**
 * The hooks electron-builder documents, and where each is inserted.
 *
 * Names come from electron-builder's NSIS templates. Placement matters because NSIS refuses
 * installer-variant StrFunc calls from an uninstall section, and because a helper declared in one
 * pass is unreferenced in the other - both real release failures.
 */
export const HOOK_PLACEMENTS: Readonly<Record<string, HookPlacement>> = {
  customHeader: 'top-level',
  preInit: 'top-level',
  customInit: 'top-level',
  customUnInit: 'top-level',
  customInstallMode: 'top-level',
  customWelcomePage: 'top-level',
  customFinishPage: 'top-level',
  licensePage: 'top-level',
  customPageAfterChangeDir: 'top-level',
  customUninstallPage: 'top-level',
  customUnWelcomePage: 'top-level',
  customInstall: 'install-section',
  customCheckAppRunning: 'install-section',
  customFiles_x64: 'install-section',
  customFiles_arm64: 'install-section',
  customFiles_ia32: 'install-section',
  customUnInstall: 'uninstall-section',
  customUnInstallSection: 'uninstall-section',
  customUnInstallCheck: 'uninstall-section',
  customRemoveFiles: 'uninstall-section',
}

const MACRO_DEFINITION = /^!macro\s+(?<name>\S+)/u

/** Every macro the installer script defines, in file order. */
export function parseDefinedMacros(scriptSource: string): readonly string[] {
  const names: string[] = []
  for (const line of scriptSource.split('\n')) {
    const name = MACRO_DEFINITION.exec(line.trim())?.groups?.['name']
    if (name !== undefined) names.push(name)
  }
  return names
}

export interface HookInsertions {
  readonly topLevel: readonly string[]
  readonly installSection: readonly string[]
  readonly uninstallSection: readonly string[]
  /** Macros the script defines that this harness has no insertion point for. */
  readonly unmapped: readonly string[]
}

/** Group the script's macros by where they must be inserted to be compiled. */
export function planHookInsertions(macros: readonly string[]): HookInsertions {
  const buckets: Record<HookPlacement | 'unmapped', string[]> = {
    'top-level': [],
    'install-section': [],
    'uninstall-section': [],
    unmapped: [],
  }

  for (const macro of macros) {
    buckets[HOOK_PLACEMENTS[macro] ?? 'unmapped'].push(macro)
  }

  return {
    topLevel: buckets['top-level'],
    installSection: buckets['install-section'],
    uninstallSection: buckets['uninstall-section'],
    unmapped: buckets.unmapped,
  }
}
