/**
 * Tells a macOS packaging failure caused by losing the connection to Apple's notary service
 * from every other failure, so the release job can rebuild once instead of failing a release on
 * a runner network blip (docs/release-and-versioning.md, "macOS signing and notarization").
 *
 * A rejected submission, a signing error, or any failure that is not notarytool losing Apple is
 * not transient and still fails the job on the first attempt.
 *
 * Dependency-free on purpose: the release job runs it with Node's built-in type stripping.
 *
 *   node scripts/notarization-failure.ts <electron-builder log>
 *   exit 0: transient notary connectivity failure; exit 1: anything else
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
const LOG_PATH_INDEX = 2

export function isTransientNotarizationFailure(log: string) {
  return log.includes(NOTARYTOOL_FAILURE) && TRANSIENT_NOTARY_ERROR.test(log)
}

const entryPath = process.argv[1]
if (entryPath && import.meta.url === pathToFileURL(entryPath).href) {
  const logPath = process.argv[LOG_PATH_INDEX]
  if (!logPath) {
    process.stderr.write('Usage: node scripts/notarization-failure.ts <electron-builder log>\n')
    process.exit(1)
  }
  process.exit(isTransientNotarizationFailure(fs.readFileSync(logPath, 'utf8')) ? 0 : 1)
}
