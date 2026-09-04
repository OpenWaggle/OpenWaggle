import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import {
  type WorkspaceExternalEditor,
  type WorkspaceExternalEditorId,
  workspaceExternalEditorLabel,
} from '@shared/types/workspace-external-editor'
import { getSafeChildEnv } from '../env'

const execFileAsync = promisify(execFile)
const EDITOR_DISCOVERY_CACHE_TTL_MS = 60_000
const EDITOR_COMMAND_PROBE_TIMEOUT_MS = 1_000
const EDITOR_COMMAND_PROBE_MAX_BUFFER_BYTES = 8 * 1024
const MACOS_APPLICATION_ROOTS = ['/Applications'] as const

type EditorLaunchStyle = 'direct-path' | 'goto' | 'line'

export interface WorkspaceExternalEditorRuntimeDefinition {
  readonly id: WorkspaceExternalEditorId
  readonly commands: readonly string[]
  readonly launchStyle: EditorLaunchStyle
  readonly macApplicationNames: readonly string[]
}

export const WORKSPACE_EXTERNAL_EDITOR_RUNTIME_DEFINITIONS = [
  {
    id: 'vscode',
    commands: ['code'],
    launchStyle: 'goto',
    macApplicationNames: ['Visual Studio Code'],
  },
  {
    id: 'vscode-insiders',
    commands: ['code-insiders'],
    launchStyle: 'goto',
    macApplicationNames: ['Visual Studio Code - Insiders'],
  },
  {
    id: 'cursor',
    commands: ['cursor'],
    launchStyle: 'goto',
    macApplicationNames: ['Cursor'],
  },
  {
    id: 'zed',
    commands: ['zed', 'zeditor'],
    launchStyle: 'direct-path',
    macApplicationNames: ['Zed'],
  },
  {
    id: 'vscodium',
    commands: ['codium'],
    launchStyle: 'goto',
    macApplicationNames: ['VSCodium'],
  },
  {
    id: 'windsurf',
    commands: ['windsurf'],
    launchStyle: 'goto',
    macApplicationNames: ['Windsurf'],
  },
  {
    id: 'sublime',
    commands: ['subl', 'sublime_text'],
    launchStyle: 'direct-path',
    macApplicationNames: ['Sublime Text'],
  },
  {
    id: 'idea',
    commands: ['idea'],
    launchStyle: 'line',
    macApplicationNames: ['IntelliJ IDEA', 'IntelliJ IDEA CE'],
  },
  {
    id: 'webstorm',
    commands: ['webstorm'],
    launchStyle: 'line',
    macApplicationNames: ['WebStorm'],
  },
  {
    id: 'pycharm',
    commands: ['pycharm'],
    launchStyle: 'line',
    macApplicationNames: ['PyCharm', 'PyCharm CE'],
  },
  {
    id: 'goland',
    commands: ['goland'],
    launchStyle: 'line',
    macApplicationNames: ['GoLand'],
  },
  {
    id: 'clion',
    commands: ['clion'],
    launchStyle: 'line',
    macApplicationNames: ['CLion'],
  },
  {
    id: 'rider',
    commands: ['rider'],
    launchStyle: 'line',
    macApplicationNames: ['Rider'],
  },
] as const satisfies readonly WorkspaceExternalEditorRuntimeDefinition[]

export interface WorkspaceExternalEditorProbeOptions {
  readonly platform?: NodeJS.Platform
  readonly homeDirectory?: string
  readonly commandAvailable?: (command: string) => Promise<boolean>
  readonly pathAvailable?: (candidatePath: string) => Promise<boolean>
}

interface EditorDiscoveryCacheEntry {
  readonly editors: readonly WorkspaceExternalEditor[]
  readonly expiresAt: number
}

let discoveryCache: EditorDiscoveryCacheEntry | null = null
let discoveryInFlight: Promise<WorkspaceExternalEditor[]> | null = null

export function workspaceExternalEditorDefinition(editorId: WorkspaceExternalEditorId) {
  return WORKSPACE_EXTERNAL_EDITOR_RUNTIME_DEFINITIONS.find((editor) => editor.id === editorId)
}

export async function workspaceExternalEditorCommandAvailable(
  command: string,
  platform: NodeJS.Platform = process.platform,
): Promise<boolean> {
  const lookupCommand = platform === 'win32' ? 'where.exe' : 'which'
  try {
    await execFileAsync(lookupCommand, [command], {
      env: getSafeChildEnv(),
      timeout: EDITOR_COMMAND_PROBE_TIMEOUT_MS,
      maxBuffer: EDITOR_COMMAND_PROBE_MAX_BUFFER_BYTES,
      windowsHide: true,
    })
    return true
  } catch {
    return false
  }
}

export async function workspaceExternalEditorPathAvailable(
  candidatePath: string,
): Promise<boolean> {
  try {
    await fs.access(candidatePath)
    return true
  } catch {
    return false
  }
}

function macApplicationCandidates(
  editor: WorkspaceExternalEditorRuntimeDefinition,
  homeDirectory: string,
) {
  const roots = [...MACOS_APPLICATION_ROOTS, path.join(homeDirectory, 'Applications')]
  return roots.flatMap((root) =>
    editor.macApplicationNames.map((name) => ({
      name,
      path: path.join(root, `${name}.app`),
    })),
  )
}

export async function findAvailableWorkspaceExternalEditorCommand(
  commands: readonly string[],
  commandAvailable: (command: string) => Promise<boolean>,
) {
  const available = await Promise.all(commands.map((command) => commandAvailable(command)))
  return commands.find((_command, index) => available[index] === true)
}

export async function findAvailableWorkspaceExternalEditorMacApplication(
  editor: WorkspaceExternalEditorRuntimeDefinition,
  homeDirectory: string,
  pathAvailable: (candidatePath: string) => Promise<boolean>,
) {
  const candidates = macApplicationCandidates(editor, homeDirectory)
  const available = await Promise.all(candidates.map((candidate) => pathAvailable(candidate.path)))
  const index = available.findIndex((isAvailable) => isAvailable)
  return index < 0 ? undefined : candidates[index]?.name
}

async function discoverWorkspaceExternalEditorsUncached(
  options: Required<Pick<WorkspaceExternalEditorProbeOptions, 'platform' | 'homeDirectory'>> &
    Pick<WorkspaceExternalEditorProbeOptions, 'commandAvailable' | 'pathAvailable'>,
): Promise<WorkspaceExternalEditor[]> {
  const commandAvailable =
    options.commandAvailable ??
    ((command: string) => workspaceExternalEditorCommandAvailable(command, options.platform))
  const pathAvailable = options.pathAvailable ?? workspaceExternalEditorPathAvailable
  const available = await Promise.all(
    WORKSPACE_EXTERNAL_EDITOR_RUNTIME_DEFINITIONS.map(async (editor) => {
      if (await findAvailableWorkspaceExternalEditorCommand(editor.commands, commandAvailable)) {
        return editor.id
      }
      if (options.platform !== 'darwin') return undefined
      const application = await findAvailableWorkspaceExternalEditorMacApplication(
        editor,
        options.homeDirectory,
        pathAvailable,
      )
      return application === undefined ? undefined : editor.id
    }),
  )

  return available.flatMap((editorId) =>
    editorId === undefined
      ? []
      : [
          {
            id: editorId,
            label: workspaceExternalEditorLabel(editorId),
          } satisfies WorkspaceExternalEditor,
        ],
  )
}

export async function discoverWorkspaceExternalEditors(
  options: WorkspaceExternalEditorProbeOptions = {},
): Promise<WorkspaceExternalEditor[]> {
  return discoverWorkspaceExternalEditorsUncached({
    platform: options.platform ?? process.platform,
    homeDirectory: options.homeDirectory ?? homedir(),
    ...(options.commandAvailable ? { commandAvailable: options.commandAvailable } : {}),
    ...(options.pathAvailable ? { pathAvailable: options.pathAvailable } : {}),
  })
}

export async function listAvailableWorkspaceExternalEditors(): Promise<WorkspaceExternalEditor[]> {
  const now = Date.now()
  if (discoveryCache && discoveryCache.expiresAt > now) return [...discoveryCache.editors]
  if (discoveryInFlight) return discoveryInFlight

  discoveryInFlight = discoverWorkspaceExternalEditors()
    .then((editors) => {
      discoveryCache = {
        editors,
        expiresAt: Date.now() + EDITOR_DISCOVERY_CACHE_TTL_MS,
      }
      return [...editors]
    })
    .finally(() => {
      discoveryInFlight = null
    })

  return discoveryInFlight
}

export function clearWorkspaceExternalEditorDiscoveryCache() {
  discoveryCache = null
  discoveryInFlight = null
}
