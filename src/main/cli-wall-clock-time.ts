import { machineTimeZone, zonedTimestamp } from '@shared/utils/zoned-time'

/**
 * A moment as wall-clock time in `timeZone` (the machine's by default), with its seconds and UTC
 * offset, e.g. `2026-10-22 17:00:07 +02:00 Europe/Madrid`. A Scheduled task reads its schedule in
 * its own zone, so the CLI shows its times there too; the offset tells the two occurrences of a
 * repeated hour apart. `--json` keeps epoch milliseconds.
 */
export function cliWallClockTime(epochMs: number, timeZone = machineTimeZone()) {
  return `${zonedTimestamp(epochMs, timeZone)} ${timeZone}`
}
