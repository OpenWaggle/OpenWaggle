/**
 * Separates macOS packaging failures caused by the GitHub runner, not by OpenWaggle, from all
 * other failures. The release job rebuilds at most twice for a runner failure so a blip does
 * not fail the release (docs/release-and-versioning.md, "Platform trust for v1").
 *
 * Two runner failures are retried:
 * - notarytool losing its connection to Apple while it waits for a verdict (1.0.0-beta.1, run
 *   36695614844);
 * - `hdiutil` failing a dmgbuild call with a device error (1.0.0-beta.8, run 37285929256:
 *   `hdiutil: create failed - Device not configured` after both apps notarized).
 *
 * A rejected submission, a signing error, or any other failure is not transient and still fails
 * the job on the first attempt, even when the same log also has a transient error from the
 * other architecture's concurrent build.
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
const LOG_PATH_INDEX = 2

export type TransientMacosBuildFailure = 'notarization-connection' | 'disk-image-device'

export function transientMacosBuildFailure(log: string): TransientMacosBuildFailure | null {
  if (log.includes(NOTARYTOOL_FAILURE)) {
    return TRANSIENT_NOTARY_ERROR.test(log) ? 'notarization-connection' : null
  }
  return FAILED_DMGBUILD_HDIUTIL_ERROR.test(log) ? 'disk-image-device' : null
}

const REASON_MESSAGES: Record<TransientMacosBuildFailure, string> = {
  'notarization-connection': 'Notarization lost its connection to Apple',
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
