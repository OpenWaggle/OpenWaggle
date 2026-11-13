/**
 * Host measurements for scripts/electrobun-probe.ts: the process tree's resident memory, an
 * OS-level screenshot, install size, and killing a launched app with its helpers.
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

export interface ProcessRow {
  readonly pid: number
  readonly ppid: number
  readonly rssBytes: number
}

const KIB = 1024
const EXEC_BUFFER_BYTES = 64 * 1024 * 1024
const WINDOWS_PROCESSES =
  'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,WorkingSetSize | ConvertTo-Json -Compress'

function field(row: object, key: string) {
  return Number(key in row ? Reflect.get(row, key) : Number.NaN)
}

function windowsProcesses() {
  const json = execFileSync('powershell', ['-NoProfile', '-Command', WINDOWS_PROCESSES], {
    encoding: 'utf8',
    maxBuffer: EXEC_BUFFER_BYTES,
  })
  const rows: unknown = JSON.parse(json)
  if (!Array.isArray(rows)) return []
  return rows.flatMap((row: unknown) => {
    if (typeof row !== 'object' || row === null) return []
    return [
      {
        pid: field(row, 'ProcessId'),
        ppid: field(row, 'ParentProcessId'),
        rssBytes: field(row, 'WorkingSetSize'),
      },
    ]
  })
}

function posixProcesses() {
  const output = execFileSync('ps', ['-A', '-o', 'pid=,ppid=,rss='], {
    encoding: 'utf8',
    maxBuffer: EXEC_BUFFER_BYTES,
  })
  return output.split('\n').flatMap((line) => {
    const [pid, ppid, rss] = line.trim().split(/\s+/u).map(Number)
    if (pid === undefined || ppid === undefined || rss === undefined || Number.isNaN(pid)) return []
    return [{ pid, ppid, rssBytes: rss * KIB }]
  })
}

/** Resident memory of a process and all its descendants (CEF helpers, WebKit processes). */
export function treeRss(rows: readonly ProcessRow[], root: number) {
  const children = new Map<number, number[]>()
  for (const row of rows) children.set(row.ppid, [...(children.get(row.ppid) ?? []), row.pid])
  const byPid = new Map(rows.map((row) => [row.pid, row]))
  const seen = new Set<number>()
  const queue = [root]
  let total = 0
  while (queue.length > 0) {
    const pid = queue.pop()
    if (pid === undefined || seen.has(pid)) continue
    seen.add(pid)
    total += byPid.get(pid)?.rssBytes ?? 0
    queue.push(...(children.get(pid) ?? []))
  }
  return { bytes: total, processes: seen.size }
}

export function appRss(root: number) {
  const rows = process.platform === 'win32' ? windowsProcesses() : posixProcesses()
  return treeRss(rows, root).bytes
}

function windowsScreenshot(file: string) {
  const script = [
    'Add-Type -AssemblyName System.Windows.Forms,System.Drawing',
    '$b = [System.Windows.Forms.SystemInformation]::VirtualScreen',
    '$i = New-Object System.Drawing.Bitmap $b.Width, $b.Height',
    '$g = [System.Drawing.Graphics]::FromImage($i)',
    '$g.CopyFromScreen($b.Left, $b.Top, 0, 0, $i.Size)',
    `$i.Save('${file.replaceAll("'", "''")}', [System.Drawing.Imaging.ImageFormat]::Png)`,
  ].join('; ')
  execFileSync('powershell', ['-NoProfile', '-Command', script])
}

const SCREENSHOT: Readonly<Record<string, (file: string) => void>> = {
  darwin: (file) => execFileSync('screencapture', ['-x', file]),
  linux: (file) => execFileSync('import', ['-window', 'root', file]),
  win32: windowsScreenshot,
}

/** Captures the whole screen; a failure is logged, not fatal, since CDP has its own screenshot. */
export function screenshot(file: string) {
  try {
    SCREENSHOT[process.platform]?.(file)
    return file
  } catch (error) {
    console.error(`screenshot failed: ${String(error)}`)
    return null
  }
}

export function killTree(pid: number) {
  try {
    if (process.platform === 'win32') execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'])
    else process.kill(-pid, 'SIGKILL')
  } catch {
    // Already gone.
  }
}

export function walk(directory: string, depth: number): string[] {
  if (depth < 0 || !fs.existsSync(directory)) return []
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name)
    if (entry.isSymbolicLink()) return [full]
    return entry.isDirectory() && !entry.name.endsWith('.framework')
      ? [full, ...walk(full, depth - 1)]
      : [full]
  })
}

export function directoryBytes(target: string): number {
  const stat = fs.lstatSync(target)
  if (stat.isSymbolicLink()) return 0
  if (!stat.isDirectory()) return stat.size
  return fs
    .readdirSync(target)
    .reduce((total, entry) => total + directoryBytes(path.join(target, entry)), 0)
}
