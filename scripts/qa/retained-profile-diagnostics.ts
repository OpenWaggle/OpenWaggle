import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'

/**
 * What a failed live QA run prints beside the GUI's own output: the profile's Host and app log
 * files (the detached Host writes nowhere else), the Session Host directory, and on Windows the
 * app's processes, so a Host that never started or never created its database shows where it
 * stopped without the retained profile, which a CI runner discards.
 */
const LOG_TAIL_LINES = 120
const LISTED_DIRECTORIES = ['logs', 'session-host'] as const
const PROCESS_LIST_TIMEOUT_MS = 10_000
const APP_PROCESS_NAMES = /electron|openwaggle|powershell|pwsh|bun/iu

async function directoryListing(userDataRoot: string, directory: string) {
  const absolute = path.join(userDataRoot, directory)
  const names = await fs.readdir(absolute).catch(() => null)
  if (names === null) return `${directory}/: does not exist`
  const lines = await Promise.all(
    names.toSorted().map(async (name) => {
      const size = await fs.stat(path.join(absolute, name)).then(
        (stats) => String(stats.size),
        () => '?',
      )
      return `  ${name} ${size} B`
    }),
  )
  return [`${directory}/:`, ...lines].join('\n')
}

async function logTails(userDataRoot: string) {
  const logs = path.join(userDataRoot, 'logs')
  const names = (await fs.readdir(logs).catch(() => [])).filter((name) => name.endsWith('.log'))
  return Promise.all(
    names.toSorted().map(async (name) => {
      const text = await fs.readFile(path.join(logs, name), 'utf8').catch(() => '')
      const lines = text.trimEnd().split('\n').slice(-LOG_TAIL_LINES)
      return [`--- logs/${name} (last ${String(lines.length)} lines)`, ...lines].join('\n')
    }),
  )
}

/** The app's processes on Windows (`tasklist`), where a hung helper is otherwise invisible. */
export function windowsAppProcesses() {
  return new Promise<string>((resolve) => {
    execFile(
      'tasklist',
      ['/fo', 'csv', '/nh'],
      { timeout: PROCESS_LIST_TIMEOUT_MS, windowsHide: true },
      (error, stdout) => {
        if (error) return resolve(`tasklist failed: ${error.message}`)
        const lines = stdout.split(/\r?\n/u).filter((line) => APP_PROCESS_NAMES.test(line))
        resolve(['processes:', ...lines.map((line) => `  ${line}`)].join('\n'))
      },
    )
  })
}

export async function retainedProfileDiagnostics(
  userDataRoot: string,
  processes: (() => Promise<string>) | null = process.platform === 'win32'
    ? windowsAppProcesses
    : null,
) {
  const listings = await Promise.all(
    LISTED_DIRECTORIES.map((directory) => directoryListing(userDataRoot, directory)),
  )
  const sections = [...listings, ...(await logTails(userDataRoot))]
  if (processes !== null) sections.push(await processes())
  return sections.join('\n')
}
