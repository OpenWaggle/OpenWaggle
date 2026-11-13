/**
 * The startup marks a bench launch logged (src/main/startup-timing.ts), read back from the profile's
 * log files the same way for both shells. Each mark's line carries the wall-clock time it was
 * logged, so a mark is placed in ms after the bench spawned the app: it counts what process uptime
 * would miss, such as an AppImage mounting itself or Electrobun's launcher starting Bun. The main
 * process's marks keep their label (`window-ready-to-show`); the Session Host's get `host:`.
 */
import fs from 'node:fs'
import path from 'node:path'

/** The window was shown: the window-ready column of the bench table (bench-stats.ts). */
export const WINDOW_SHOWN_MARK = 'window-ready-to-show'

const LOG_FILE = /^openwaggle-(host-)?(\d{4}-\d{2}-\d{2})\.log$/u
const MARK_LINE =
  /^(\d{2}:\d{2}:\d{2}\.\d{3})Z \[[^\]]+\] Startup timing at [0-9.]+ ms uptime (\{.*\})$/u
const LABEL_FIELD = /"label":"([^"]+)"/u

/** Marks in one log file's text, as epoch ms by label, the first of each label at or after `since`. */
export function marksInLog(text: string, date: string, since: number) {
  const marks = new Map<string, number>()
  for (const line of text.split('\n')) {
    const [, time, data] = MARK_LINE.exec(line.trimEnd()) ?? []
    const label = data === undefined ? undefined : LABEL_FIELD.exec(data)?.[1]
    if (time === undefined || label === undefined || marks.has(label)) continue
    const at = Date.parse(`${date}T${time}Z`)
    if (at >= since) marks.set(label, at)
  }
  return marks
}

/** The launch's marks, in ms after `spawnedAt`, from every app and Host log in `logsDirectory`. */
export function startupMarksSince(logsDirectory: string, spawnedAt: number) {
  const marks: Record<string, number> = {}
  const files = fs.existsSync(logsDirectory) ? fs.readdirSync(logsDirectory).sort() : []
  for (const file of files) {
    const [, host, date] = LOG_FILE.exec(file) ?? []
    if (date === undefined) continue
    const text = fs.readFileSync(path.join(logsDirectory, file), 'utf8')
    for (const [label, at] of marksInLog(text, date, spawnedAt)) {
      const key = host === undefined ? label : `host:${label}`
      if (!(key in marks)) marks[key] = at - spawnedAt
    }
  }
  return marks
}
