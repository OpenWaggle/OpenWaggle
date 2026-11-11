import { type ExecFileOptions, execFile } from 'node:child_process'
import { homedir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { getDesktopHelperChildEnv } from '../../env'
import type { FileFilter, SaveDialogRequest } from '../../ports/desktop-shell/dialogs'

/** Promisified on use, so loading this module runs nothing of `node:child_process`. */
function run(command: string, args: readonly string[], options: ExecFileOptions) {
  return promisify(execFile)(command, [...args], { ...options, encoding: 'utf8' })
}

/**
 * Electrobun has no save dialog (ADR 0064 gap), so the platform's own save panel is opened
 * through a tool every supported desktop has: AppleScript's `choose file name` on macOS (an
 * NSSavePanel), Windows Forms' `SaveFileDialog` through Windows PowerShell, and zenity or kdialog
 * on Linux. Request values travel as arguments or environment variables, never as script text.
 * Resolves to the chosen path, or null when the user cancelled.
 */
const MACOS_SCRIPT = [
  'on run argv',
  'set chosen to choose file name with prompt (item 1 of argv) default name (item 2 of argv) default location (POSIX file (item 3 of argv))',
  'return POSIX path of chosen',
  'end run',
]
const MACOS_USER_CANCELLED = -128

const WINDOWS_SCRIPT = [
  '[Console]::OutputEncoding = [Text.Encoding]::UTF8',
  'Add-Type -AssemblyName System.Windows.Forms',
  '$dialog = New-Object System.Windows.Forms.SaveFileDialog',
  '$dialog.Title = $env:OPENWAGGLE_SAVE_TITLE',
  '$dialog.FileName = $env:OPENWAGGLE_SAVE_NAME',
  'if ($env:OPENWAGGLE_SAVE_DIRECTORY) { $dialog.InitialDirectory = $env:OPENWAGGLE_SAVE_DIRECTORY }',
  'if ($env:OPENWAGGLE_SAVE_FILTER) { $dialog.Filter = $env:OPENWAGGLE_SAVE_FILTER }',
  "if ($dialog.ShowDialog() -eq 'OK') { [Console]::Out.Write($dialog.FileName) }",
].join('; ')

function defaults(request: SaveDialogRequest) {
  const defaultPath = request.defaultPath ?? ''
  const hasDirectory = path.isAbsolute(defaultPath)
  return {
    title: request.title ?? 'Save',
    name: path.basename(defaultPath) || 'Untitled',
    directory: hasDirectory ? path.dirname(defaultPath) : '',
    defaultPath,
  }
}

function windowsFilter(filters: readonly FileFilter[] | undefined) {
  return (filters ?? [])
    .map((filter) => {
      const patterns = filter.extensions.map((extension) => `*.${extension}`).join(';')
      return `${filter.name}|${patterns}`
    })
    .join('|')
}

function exitCode(error: unknown) {
  const code: unknown = typeof error === 'object' && error ? Reflect.get(error, 'code') : null
  return typeof code === 'number' ? code : null
}

function stderrOf(error: unknown) {
  const stderr: unknown = typeof error === 'object' && error ? Reflect.get(error, 'stderr') : ''
  return typeof stderr === 'string' ? stderr : ''
}

async function macOsSavePanel(request: SaveDialogRequest) {
  const { title, name, directory } = defaults(request)
  const args = MACOS_SCRIPT.flatMap((line) => ['-e', line])
  try {
    const { stdout } = await run('osascript', [...args, title, name, directory || homedir()], {
      env: getDesktopHelperChildEnv(),
    })
    const chosen = stdout.trim()
    return chosen.length > 0 ? chosen : null
  } catch (error) {
    if (stderrOf(error).includes(String(MACOS_USER_CANCELLED))) return null
    throw error
  }
}

async function windowsSavePanel(request: SaveDialogRequest) {
  const { title, name, directory } = defaults(request)
  const { stdout } = await run(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-STA', '-Command', WINDOWS_SCRIPT],
    {
      env: {
        ...getDesktopHelperChildEnv(),
        OPENWAGGLE_SAVE_TITLE: title,
        OPENWAGGLE_SAVE_NAME: name,
        OPENWAGGLE_SAVE_DIRECTORY: directory,
        OPENWAGGLE_SAVE_FILTER: windowsFilter(request.filters),
      },
      windowsHide: true,
    },
  )
  return stdout.length > 0 ? stdout : null
}

/** zenity and kdialog both exit 1 on cancel and print the path otherwise. */
const LINUX_CANCELLED = 1

async function linuxSavePanel(request: SaveDialogRequest) {
  const { title, defaultPath, name } = defaults(request)
  const candidates = [
    {
      command: 'zenity',
      args: [
        '--file-selection',
        '--save',
        '--confirm-overwrite',
        `--title=${title}`,
        `--filename=${defaultPath || name}`,
      ],
    },
    { command: 'kdialog', args: ['--title', title, '--getsavefilename', defaultPath || name] },
  ]
  for (const candidate of candidates) {
    try {
      const { stdout } = await run(candidate.command, candidate.args, {
        env: getDesktopHelperChildEnv(),
      })
      const chosen = stdout.trim()
      return chosen.length > 0 ? chosen : null
    } catch (error) {
      if (exitCode(error) === LINUX_CANCELLED) return null
      if (Reflect.get(Object(error), 'code') !== 'ENOENT') throw error
    }
  }
  throw new Error('Saving a file needs zenity or kdialog; install one of them and try again.')
}

export function showNativeSaveDialog(request: SaveDialogRequest) {
  if (process.platform === 'darwin') return macOsSavePanel(request)
  if (process.platform === 'win32') return windowsSavePanel(request)
  return linuxSavePanel(request)
}
