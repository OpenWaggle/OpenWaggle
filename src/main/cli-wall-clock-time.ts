import { machineTimeZone, zonedDateTime } from '@shared/utils/zoned-time'

const DATE_PART_LENGTH = 2

function pad(value: number) {
  return String(value).padStart(DATE_PART_LENGTH, '0')
}

/**
 * A moment as wall-clock time in `timeZone` (the machine's by default), e.g.
 * `2026-10-22 17:00 Europe/Madrid`. A Scheduled task reads its schedule in its own zone, so the
 * CLI shows its times there too; `--json` keeps epoch milliseconds.
 */
export function cliWallClockTime(epochMs: number, timeZone = machineTimeZone()) {
  const zoned = zonedDateTime(epochMs, timeZone)
  return `${String(zoned.year)}-${pad(zoned.month)}-${pad(zoned.day)} ${pad(zoned.hour)}:${pad(zoned.minute)} ${timeZone}`
}
