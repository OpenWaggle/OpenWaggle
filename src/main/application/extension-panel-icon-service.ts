import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import type {
  ExtensionContributionRegistryEntry,
  ExtensionContributionRegistryView,
  ExtensionDiagnosticView,
  ExtensionListContributionsInput,
} from '@shared/types/extensions'
import * as Effect from 'effect/Effect'
import {
  type ExtensionPanelIconResolution,
  ExtensionPanelIconResolver,
} from '../ports/extension-panel-icon-resolver'
import { buildExtensionContributionRegistry } from './extension-contribution-registry-service'
import type { ContributionIconDeclaration } from './extension-contribution-registry-types'

const PANEL_ICON_RESOLUTION_CONCURRENCY = 8

function iconDiagnosticPath(entry: ExtensionContributionRegistryEntry, filePath?: string) {
  return (
    filePath ?? `${entry.manifestPath}#contributions.${entry.family}.${entry.contributionId}.icon`
  )
}

function panelIconDiagnostic(
  entry: ExtensionContributionRegistryEntry,
  resolution: Extract<ExtensionPanelIconResolution, { readonly status: 'invalid' }>,
): ExtensionDiagnosticView {
  return {
    severity: OPENWAGGLE_EXTENSION.DIAGNOSTIC.SEVERITY.WARNING,
    code: OPENWAGGLE_EXTENSION.DIAGNOSTIC.CODE.PANEL_ICON_INVALID,
    message: `Side panel "${entry.title}" shows a letter tile because its icon is unusable: ${resolution.message}`,
    path: iconDiagnosticPath(entry, resolution.path),
  }
}

function applyPanelIconResolution(
  entry: ExtensionContributionRegistryEntry,
  resolution: ExtensionPanelIconResolution,
) {
  if (resolution.status === 'resolved') {
    return { entry: { ...entry, icon: resolution.icon }, diagnostic: null }
  }
  const diagnostic = panelIconDiagnostic(entry, resolution)
  return { entry: { ...entry, diagnostics: [...entry.diagnostics, diagnostic] }, diagnostic }
}

function uniqueDiagnostics(diagnostics: readonly ExtensionDiagnosticView[]) {
  const seen = new Set<string>()
  return diagnostics.filter((diagnostic) => {
    const key = JSON.stringify([diagnostic.code, diagnostic.path, diagnostic.message])
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function resolveDeclaredPanelIcons(declarations: readonly ContributionIconDeclaration[]) {
  return Effect.gen(function* () {
    const resolver = yield* ExtensionPanelIconResolver
    const resolved = yield* Effect.forEach(
      declarations,
      (declaration) =>
        resolver
          .resolve({
            packagePath: declaration.entry.packagePath,
            contentHash: declaration.entry.contentHash,
            icon: declaration.icon,
          })
          .pipe(
            Effect.map((resolution) => ({
              original: declaration.entry,
              ...applyPanelIconResolution(declaration.entry, resolution),
            })),
          ),
      { concurrency: PANEL_ICON_RESOLUTION_CONCURRENCY },
    )
    return {
      entries: new Map(resolved.map((result) => [result.original, result.entry] as const)),
      diagnostics: resolved.flatMap((result) => (result.diagnostic ? [result.diagnostic] : [])),
    }
  })
}

/**
 * The registry view for surfaces that draw side panels: each side panel with a declared Panel rail
 * icon carries the resolved `icon`, or a warning diagnostic when the icon is unusable (ADR 0043).
 * The warning is also listed with the registry diagnostics so Settings shows it.
 */
export function listExtensionContributionRegistryViewWithPanelIcons(
  input: ExtensionListContributionsInput = {},
) {
  return Effect.gen(function* () {
    const registry = yield* buildExtensionContributionRegistry(input)
    const resolved = yield* resolveDeclaredPanelIcons(registry.iconDeclarations)
    return {
      ...registry.view,
      entries: registry.view.entries.map((entry) => resolved.entries.get(entry) ?? entry),
      diagnostics: [
        ...(registry.view.diagnostics ?? []),
        ...uniqueDiagnostics(resolved.diagnostics),
      ],
    } satisfies ExtensionContributionRegistryView
  })
}
