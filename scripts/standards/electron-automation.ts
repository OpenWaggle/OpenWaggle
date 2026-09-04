import path from 'node:path'
import { withoutCommentLines } from './comment-stripping'

const DESKTOP_UI_POLICY_OWNERS = ['src/main/desktop-ui.ts', 'src/main/desktop-window-policy.ts']
const PLAYWRIGHT_ELECTRON_LAUNCH_OWNER = 'scripts/playwright-electron-launcher.ts'
const ELECTRON_VITE_LAUNCH_OWNERS = [
  'scripts/measure-main-startup.ts',
  'scripts/start-electron-qa.ts',
]
const UNGUARDED_DESKTOP_UI_PATTERNS: readonly {
  readonly api: string
  readonly pattern: RegExp
}[] = [
  { api: 'Electron dialog', pattern: /\bdialog\s*\.\s*show[A-Z][\w]*\s*\(/gu },
  {
    api: 'Electron shell UI',
    pattern: /\bshell\s*\.\s*(?:beep|openExternal|openPath|showItemInFolder|trashItem)\s*\(/gu,
  },
  {
    api: 'Electron window construction',
    pattern: /\bnew\s+(?:BaseWindow|BrowserWindow)\s*\(/gu,
  },
  {
    api: 'BrowserWindow reveal',
    pattern:
      /\b(?:[A-Za-z_$][\w$]*Window|window)\s*\.\s*(?:focus|restore|show|showInactive)\s*\(\s*\)/gu,
  },
  {
    api: 'detached external application',
    pattern: /\bdetached\s*:\s*true\b/gu,
  },
  { api: 'application focus', pattern: /\bapp\s*\.\s*focus\s*\(/gu },
  { api: 'native notification', pattern: /\bnew\s+Notification\s*\(/gu },
]

function normalizePath(filePath: string) {
  return filePath.split(path.sep).join('/')
}

function importedElectronAliases(contents: string, importedName: string) {
  const aliases: string[] = []
  const importPattern = /\bimport\s*\{([^}]*)\}\s*from\s*['"]electron['"]/gu
  for (const match of contents.matchAll(importPattern)) {
    const importList = match[1]
    if (!importList) continue
    for (const rawSpecifier of importList.split(',')) {
      const specifier = rawSpecifier.trim()
      if (specifier.startsWith('type ')) continue
      const parts = specifier.split(/\s+as\s+/u)
      if (parts[0] === importedName) aliases.push(parts[1] ?? importedName)
    }
  }
  return aliases
}

function namespaceElectronAliases(contents: string) {
  return [...contents.matchAll(/\bimport\s*\*\s*as\s*(\w+)\s*from\s*['"]electron['"]/gu)].flatMap(
    (match) => (match[1] ? [match[1]] : []),
  )
}

function playwrightElectronAliases(contents: string) {
  const aliases: string[] = []
  const importPattern = /\bimport\s*\{([^}]*)\}\s*from\s*['"]@playwright\/test['"]/gu
  for (const match of contents.matchAll(importPattern)) {
    const importList = match[1]
    if (!importList) continue
    for (const rawSpecifier of importList.split(',')) {
      const parts = rawSpecifier.trim().split(/\s+as\s+/u)
      if (parts[0] === '_electron') aliases.push(parts[1] ?? '_electron')
    }
  }
  return aliases
}

function childProcessSpawnAliases(contents: string) {
  const aliases: string[] = []
  const importPattern = /\bimport\s*\{([^}]*)\}\s*from\s*['"](?:node:)?child_process['"]/gu
  for (const match of contents.matchAll(importPattern)) {
    const importList = match[1]
    if (!importList) continue
    for (const rawSpecifier of importList.split(',')) {
      const parts = rawSpecifier.trim().split(/\s+as\s+/u)
      if (parts[0] === 'spawn') aliases.push(parts[1] ?? 'spawn')
    }
  }
  return aliases
}

function importedDesktopUiViolations(file: string, code: string) {
  const violations: { readonly file: string; readonly message: string; readonly detail: string }[] = []
  const importsElectronNamespace = namespaceElectronAliases(code).length > 0
  const importsElectronDefault =
    /\bimport\s+(?!type\b)[A-Za-z_$][\w$]*(?:\s*,\s*(?:\{[^}]*\}|\*\s+as\s+[A-Za-z_$][\w$]*))?\s+from\s*['"]electron['"]/u.test(
      code,
    )
  const loadsElectronDynamically =
    /\b(?:require|import)\s*\(\s*['"]electron['"]\s*\)/u.test(code)
  if (importsElectronNamespace || importsElectronDefault || loadsElectronDynamically) {
    violations.push({
      file,
      message: 'Import Electron capabilities explicitly through audited policy boundaries',
      detail: 'broad Electron module access exposes native window constructors to local aliases',
    })
  }
  for (const api of ['dialog', 'shell', 'Notification'] as const) {
    if (importedElectronAliases(code, api).length > 0) {
      violations.push({
        file,
        message: `Route Electron ${api} through the audited desktop UI policy`,
        detail: 'direct Electron desktop-UI imports can bypass automation blockers',
      })
    }
  }

  const windowAliases = [
    ...importedElectronAliases(code, 'BrowserWindow'),
    ...importedElectronAliases(code, 'BaseWindow'),
  ]
  if (windowAliases.length > 0) {
    violations.push({
      file,
      message: 'Access Electron window classes through the audited desktop UI policy',
      detail: 'value imports expose native constructors that default to visible windows',
    })
  }
  return violations
}

export function collectUnguardedDesktopUiViolations(file: string, contents: string) {
  const normalized = normalizePath(file)
  if (!normalized.startsWith('src/main/') || !/\.(?:ts|tsx|mts|cts)$/.test(normalized)) return []
  if (DESKTOP_UI_POLICY_OWNERS.includes(normalized) || normalized.includes('__tests__')) return []
  const code = withoutCommentLines(contents)

  const callViolations = UNGUARDED_DESKTOP_UI_PATTERNS.flatMap(({ api, pattern }) => {
    pattern.lastIndex = 0
    return pattern.test(code)
      ? [
          {
            file: normalized,
            message: `Route ${api} through the audited desktop UI policy`,
            detail: 'automation must fail closed before native OS UI can appear',
          },
        ]
      : []
  })
  return [...importedDesktopUiViolations(normalized, code), ...callViolations]
}

export function collectScriptedElectronLaunchViolations(file: string, contents: string) {
  const normalized = normalizePath(file)
  if (!/\.(?:ts|tsx|mts|cts)$/.test(normalized) || normalized.includes('__tests__')) return []
  const code = withoutCommentLines(contents)
  const launchesWithPlaywright =
    /\belectron\s*\.\s*launch\s*\(/u.test(code) ||
    playwrightElectronAliases(code).some((alias) =>
      new RegExp(`\\b${alias}\\s*\\.\\s*launch\\s*\\(`, 'u').test(code),
    ) || /\b\w+\s*\.\s*_electron\s*\.\s*launch\s*\(/u.test(code)
  const launchesElectronVite =
    (/\bspawn\s*\(/u.test(code) ||
      childProcessSpawnAliases(code).some((alias) =>
        new RegExp(`\\b${alias}\\s*\\(`, 'u').test(code),
      )) &&
    code.includes('electron-vite') &&
    /['"]dev['"]/u.test(code)
  if (launchesWithPlaywright && normalized === PLAYWRIGHT_ELECTRON_LAUNCH_OWNER) return []
  if (launchesElectronVite && ELECTRON_VITE_LAUNCH_OWNERS.includes(normalized)) return []
  if (!launchesWithPlaywright && !launchesElectronVite) return []
  return [
    {
      file: normalized,
      message: 'Scripted Electron launches must opt into explicit non-disruptive automation mode',
      detail: 'set OPENWAGGLE_AUTOMATION=1 in the child environment',
    },
  ]
}
