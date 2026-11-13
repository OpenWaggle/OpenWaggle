import path from 'node:path'
import { withoutCommentLines } from './comment-stripping'

/**
 * The desktop shell adapters that own native desktop UI (ADR 0064). Electrobun's adapters check
 * the automation policy at the top of each OS-visible member
 * (src/main/adapters/electrobun/electrobun-automation.ts), and the rest of main reaches them only
 * through the desktop shell ports.
 */
const DESKTOP_UI_POLICY_OWNERS = [
  'src/main/adapters/electrobun/electrobun-dialogs.ts',
  'src/main/adapters/electrobun/electrobun-menus.ts',
  'src/main/adapters/electrobun/electrobun-os-shell.ts',
  'src/main/adapters/electrobun/electrobun-save-dialog.ts',
  'src/main/adapters/electrobun/electrobun-system-notifications.ts',
  // The only Electrobun module that constructs, shows or focuses a window; it creates every
  // window hidden under automation and checks the policy before revealing one.
  'src/main/adapters/electrobun/electrobun-window-policy.ts',
]
/**
 * The detached-spawn primitive behind `desktop-ui.ts`: the boot shim launches the headless Session
 * Host through it before the main bundle (and the desktop UI policy) loads. External applications
 * still go through `launchExternalApplication`. Only the detached pattern is allowed there.
 */
const DETACHED_PROCESS_PRIMITIVE = 'src/main/detached-process.ts'
const DETACHED_PROCESS_API = 'detached external application'
const UNGUARDED_DESKTOP_UI_PATTERNS: readonly {
  readonly api: string
  readonly pattern: RegExp
}[] = [
  { api: 'native dialog', pattern: /\bdialog\s*\.\s*show[A-Z][\w]*\s*\(/gu },
  {
    api: 'OS shell UI',
    pattern: /\bshell\s*\.\s*(?:beep|openExternal|openPath|showItemInFolder|trashItem)\s*\(/gu,
  },
  {
    // `new BrowserWindow(...)`, and Electrobun's lazily loaded `new (sdk.BrowserWindow)(...)`.
    api: 'window construction',
    pattern: /\bnew\s+(?:\(\s*[\w$.()]*?\.\s*)?(?:BaseWindow|BrowserWindow)\s*\)?\s*\(/gu,
  },
  {
    // Window reveal calls, Electrobun's `activate` and `unminimize` included.
    api: 'BrowserWindow reveal',
    pattern:
      /\b(?:[A-Za-z_$][\w$]*Window|window)\s*\.\s*(?:activate|focus|restore|show|showInactive|unminimize)\s*\(\s*\)/gu,
  },
  {
    api: 'detached external application',
    pattern: /\bdetached\s*:\s*true\b/gu,
  },
  { api: 'application focus', pattern: /\bapp\s*\.\s*focus\s*\(/gu },
  { api: 'native context menu', pattern: /\.\s*popup\s*\(/gu },
  { api: 'native notification', pattern: /\bnew\s+Notification\s*\(/gu },
  {
    api: 'Electrobun desktop UI',
    pattern:
      /\bUtils\s*\.\s*(?:openExternal|openPath|showItemInFolder|moveToTrash|showMessageBox|openFileDialog|showNotification)\s*\(/gu,
  },
  { api: 'Electrobun context menu', pattern: /\bshowContextMenu\s*\(/gu },
]

function normalizePath(filePath: string) {
  return filePath.split(path.sep).join('/')
}

export function collectUnguardedDesktopUiViolations(file: string, contents: string) {
  const normalized = normalizePath(file)
  if (!normalized.startsWith('src/main/') || !/\.(?:ts|tsx|mts|cts)$/.test(normalized)) return []
  if (DESKTOP_UI_POLICY_OWNERS.includes(normalized) || normalized.includes('__tests__')) return []
  const code = withoutCommentLines(contents)

  const callViolations = UNGUARDED_DESKTOP_UI_PATTERNS.flatMap(({ api, pattern }) => {
    if (api === DETACHED_PROCESS_API && normalized === DETACHED_PROCESS_PRIMITIVE) return []
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
  return callViolations
}

/**
 * Every script that drives the app over the CEF DevTools endpoint starts it through one launcher,
 * which always sets OPENWAGGLE_AUTOMATION=1 (the window stays hidden and no OS UI appears) and
 * scratch HOME, Pi agent and userData directories.
 */
const AUTOMATION_LAUNCH_OWNER = 'scripts/support/electrobun-app-launch.ts'
const AUTOMATION_LAUNCH_SETTINGS =
  /\b(?:ELECTROBUN_CEF_REMOTE_DEBUGGING_PORT|OPENWAGGLE_QA_MAIN_WINDOW_RENDERER)\b/u

const DEV_SCRIPT = `['"\`](?:run['"\`]\\s*,\\s*['"\`])?dev(?::debug(?::headed)?)?['"\`]`
/** The package manager that runs a script: `bun` (or `bunExecutable()`), or `pnpm`. */
const PACKAGE_MANAGER = `(?:['"\`](?:bun|pnpm)['"\`]|\\bbunExecutable\\s*\\(\\s*\\))`
/** The package manager called with a dev script (`dev`, `run dev`, `dev:debug[:headed]`) in its list. */
const PACKAGE_MANAGER_DEV_CALL = new RegExp(
  `${PACKAGE_MANAGER}\\s*,\\s*\\[[^\\]]*?${DEV_SCRIPT}`,
  'u',
)
/** The package manager (or its own script, `npm_execpath`) as the argument right before a dev script. */
const PACKAGE_MANAGER_DEV_ARGV = new RegExp(
  `(?:${PACKAGE_MANAGER}|\\bnpm_execpath\\b[^,\\n]{0,40}?)\\s*,\\s*${DEV_SCRIPT}`,
  'u',
)
/** Such a list built first, holding only the script or the script and its switches. */
const DEV_SCRIPT_LIST = new RegExp(`\\[\\s*${DEV_SCRIPT}\\s*(?:\\]|,\\s*['"\`]--)`, 'u')
const PACKAGE_MANAGER_NAMED = /['"`](?:bun|pnpm)['"`]|\bbunExecutable\b/u
/** A `bun run dev`, `bun dev` or `pnpm dev` command string passed to exec or spawn. */
const PACKAGE_MANAGER_DEV_COMMAND =
  /\b(?:exec|execSync|spawn|spawnSync)\s*\(\s*['"`](?:bun|pnpm)\s+(?:run\s+)?dev(?::debug(?::headed)?)?(?=[\s'"`])/u
/** The development launcher, run or imported by its path. */
const DEVELOPMENT_LAUNCHER = /\belectrobun\/dev(?:\.ts)?['"`]/u
/** `bun run dev` itself, which a person runs to open the visible development app. */
const DEVELOPMENT_LAUNCH_OWNERS: readonly string[] = ['scripts/electrobun/dev.ts']

/**
 * The development launcher (run or imported by its path), or a package manager running a dev
 * script. Either opens the visible development app, which automation must never do. The app's own
 * code runs a project's `bun dev` or `pnpm dev` for the user (project actions) and shows it, so
 * `src/` is left to other rules.
 */
function launchesDevelopmentApp(code: string) {
  return (
    DEVELOPMENT_LAUNCHER.test(code) ||
    PACKAGE_MANAGER_DEV_CALL.test(code) ||
    PACKAGE_MANAGER_DEV_ARGV.test(code) ||
    (PACKAGE_MANAGER_NAMED.test(code) && DEV_SCRIPT_LIST.test(code)) ||
    PACKAGE_MANAGER_DEV_COMMAND.test(code)
  )
}

export function collectScriptedAppLaunchViolations(file: string, contents: string) {
  const normalized = normalizePath(file)
  if (!/^(?:scripts|packages)\//u.test(normalized) || !/\.(?:ts|tsx|mts|cts)$/.test(normalized)) {
    return []
  }
  // The launcher owns the settings; tests and this rule name them without launching anything.
  if (normalized === AUTOMATION_LAUNCH_OWNER || normalized.includes('__tests__')) return []
  if (normalized.startsWith('scripts/standards/')) return []
  const code = withoutCommentLines(contents)
  const automationSettings = AUTOMATION_LAUNCH_SETTINGS.test(code)
  const developmentApp =
    launchesDevelopmentApp(code) && !DEVELOPMENT_LAUNCH_OWNERS.includes(normalized)
  if (!automationSettings && !developmentApp) return []
  return [
    {
      file: normalized,
      message: `Start the app for automation through ${AUTOMATION_LAUNCH_OWNER}`,
      detail: developmentApp
        ? 'a scripted `bun run dev` opens the visible development app; the launcher sets OPENWAGGLE_AUTOMATION=1'
        : 'it sets OPENWAGGLE_AUTOMATION=1 and scratch profile directories',
    },
  ]
}
