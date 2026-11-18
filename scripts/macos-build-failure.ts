/**
 * Separates macOS packaging failures caused by the GitHub runner, not by OpenWaggle, from all
 * other failures. The release job rebuilds at most twice for a runner failure so a blip does
 * not fail the release (docs/release-and-versioning.md, "Platform trust for v1").
 *
 * Three runner failures are retried:
 * - notarytool losing its connection to Apple while it waits for a verdict (1.0.0-beta.1, run
 *   36695614844);
 * - stapler losing its connection to Apple's ticket service after notarization succeeded
 *   (1.0.0-beta.36, run 42493633669: `NSURLErrorDomain Code=-1005` from api.apple-cloudkit.com,
 *   `The staple and validate action failed! Error 68.`);
 * - `hdiutil` failing a dmgbuild call with a device error (1.0.0-beta.8, run 37285929256:
 *   `hdiutil: create failed - Device not configured` after both apps notarized).
 *
 * A rejected submission, a signing error, or any other failure is not transient and still fails
 * the job on the first attempt. A notary rejection or credential error does so even when the
 * same log also has a transient error from the other architecture's concurrent build: each
 * failure report is judged by its own output, never by an error printed elsewhere in the log.
 *
 * Dependency-free on purpose: the release job runs it with Node's built-in type stripping.
 *
 *   node scripts/macos-build-failure.ts <electron-builder log>
 *   exit 0 and print the reason: transient runner failure; exit 1: anything else
 */
import fs from 'node:fs'
import { pathToFileURL } from 'node:url'

const NOTARYTOOL_FAILURE = 'Failed to notarize via notarytool'
/**
 * notarytool reports transport failures as `HTTPError(statusCode: nil, ...)` wrapping an
 * NSURLErrorDomain error (offline, timed out, connection lost, DNS), and Apple-side outages as
 * a 5xx status. A 4xx status or an `Invalid` verdict is a real answer from Apple, not a blip.
 */
const TRANSIENT_NOTARY_ERROR =
  /HTTPError\(statusCode: (?:nil|5\d\d)\b|Error Domain=NSURLErrorDomain Code=-10\d\d\b/u
/** `@electron/notarize` staples after a successful notarization and reports this on failure. */
const STAPLE_FAILURE = 'Failed to staple your application'
/**
 * stapler fetches the ticket from CloudKit and prints the NSURLErrorDomain error when the request
 * never got an answer. An answer it rejects (no ticket, an invalid signature) has no such error.
 */
const TRANSIENT_STAPLE_ERROR = /Error Domain=NSURLErrorDomain Code=-10\d\d\b/u
/**
 * GitHub's macOS runners intermittently fail disk-image operations with a device error (see
 * actions/runner-images#7522). A full disk or a bad dmgbuild setting reports a different error.
 * `patches/dmg-builder@*.patch` retries the same pattern per DMG; keep the two identical.
 * Detach is left out because dmgbuild already retries it and reports it in a different format.
 */
export const TRANSIENT_HDIUTIL_ERROR =
  /hdiutil: (?:create|attach|convert|resize) failed - (?:Device not configured|Resource busy|Resource temporarily unavailable)/u
/**
 * Only an hdiutil error inside the failing dmgbuild report counts, so a recovered hdiutil warning
 * elsewhere in the log cannot turn an unrelated failure into a retry. electron-builder prints
 * the dmgbuild output between `dmgbuild process failed` and the `failedTask=` trailer.
 */
const FAILED_DMGBUILD_HDIUTIL_ERROR = new RegExp(
  `dmgbuild process failed(?:(?!failedTask=)[\\s\\S])*?(?:${TRANSIENT_HDIUTIL_ERROR.source})`,
  'u',
)
const FAILED_TASK_TRAILER = 'failedTask='
const LOG_PATH_INDEX = 2

export type TransientMacosBuildFailure =
  | 'notarization-connection'
  | 'staple-connection'
  | 'disk-image-device'

/**
 * Each failure electron-builder printed for `marker`: from the marker to the `failedTask=`
 * trailer that ends its report, or to the end of the log when the trailer is missing. The
 * trailer line repeats the message (`stackTrace=Error: <marker>`), so the search for the next
 * report resumes after it.
 */
function failureReports(log: string, marker: string) {
  const reports: string[] = []
  let start = log.indexOf(marker)
  while (start !== -1) {
    const trailer = log.indexOf(FAILED_TASK_TRAILER, start + marker.length)
    if (trailer === -1) {
      reports.push(log.slice(start))
      break
    }
    reports.push(log.slice(start, trailer))
    const trailerLineEnd = log.indexOf('\n', trailer)
    start = trailerLineEnd === -1 ? -1 : log.indexOf(marker, trailerLineEnd)
  }
  return reports
}

function everyReportMatches(reports: readonly string[], transientError: RegExp) {
  return reports.every((report) => transientError.test(report))
}

export function transientMacosBuildFailure(log: string) {
  const notaryReports = failureReports(log, NOTARYTOOL_FAILURE)
  if (notaryReports.length > 0) {
    return everyReportMatches(notaryReports, TRANSIENT_NOTARY_ERROR)
      ? ('notarization-connection' as const)
      : null
  }
  const stapleReports = failureReports(log, STAPLE_FAILURE)
  if (stapleReports.length > 0) {
    return everyReportMatches(stapleReports, TRANSIENT_STAPLE_ERROR)
      ? ('staple-connection' as const)
      : null
  }
  return FAILED_DMGBUILD_HDIUTIL_ERROR.test(log) ? ('disk-image-device' as const) : null
}

const REASON_MESSAGES: Record<TransientMacosBuildFailure, string> = {
  'notarization-connection': 'Notarization lost its connection to Apple',
  'staple-connection': 'Stapling the notarization ticket lost its connection to Apple',
  'disk-image-device': 'hdiutil hit a runner device error while building the DMG',
}

const entryPath = process.argv[1]
if (entryPath && import.meta.url === pathToFileURL(entryPath).href) {
  const logPath = process.argv[LOG_PATH_INDEX]
  if (!logPath) {
    process.stderr.write('Usage: node scripts/macos-build-failure.ts <electron-builder log>\n')
    process.exit(1)
  }
  const failure = transientMacosBuildFailure(fs.readFileSync(logPath, 'utf8'))
  if (!failure) {
    process.exit(1)
  }
  process.stdout.write(`${REASON_MESSAGES[failure]}\n`)
  process.exit(0)
}
