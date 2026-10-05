/**
 * Separates macOS packaging failures caused by the GitHub runner, not by OpenWaggle, from all
 * other failures. The release job rebuilds once for a runner failure so a blip does not fail the
 * release (docs/release-and-versioning.md, "macOS signing and notarization").
 *
 * Two runner failures are retried:
 * - notarytool losing its connection to Apple while it waits for a verdict (1.0.0-beta.1, run
 *   36695614844);
 * - `hdiutil` failing to create or mount the DMG disk image with a device error (1.0.0-beta.8,
 *   run 37285929256: `hdiutil: create failed - Device not configured` after both apps notarized).
 *
 * A rejected submission, a signing error, or any other failure is not transient and still fails
 * the job on the first attempt.
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
 */
const TRANSIENT_HDIUTIL_ERROR =
  /hdiutil: (?:create|attach|detach|convert|resize) failed - (?:Device not configured|Resource busy|Resource temporarily unavailable)/u
const LOG_PATH_INDEX = 2

export type TransientMacosBuildFailure = 'notarization-connection' | 'disk-image-device'

export function transientMacosBuildFailure(log: string): TransientMacosBuildFailure | null {
  if (log.includes(NOTARYTOOL_FAILURE) && TRANSIENT_NOTARY_ERROR.test(log)) {
    return 'notarization-connection'
  }
  if (TRANSIENT_HDIUTIL_ERROR.test(log)) {
    return 'disk-image-device'
  }
  return null
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
