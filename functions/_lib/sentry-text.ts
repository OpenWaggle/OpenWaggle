/**
 * Text rules for error reports at the endpoint. They are the rules the app scrubs by too,
 * shared through src/shared/error-reporting/error-report-rules.ts so both scrubbers stay
 * identical, plus Windows temporary folders: the app replaces the machine's own `%TEMP%`, which
 * the endpoint cannot know, so here they are recognized by shape. A profile's
 * `~\AppData\Local\Temp`, left by the home-directory rule, and `C:\Windows\Temp` become `<tmp>`.
 */
import {
  scrubErrorReportPaths,
  scrubErrorReportText,
} from '../../src/shared/error-reporting/error-report-rules'

const TEMPORARY = '<tmp>'
const WINDOWS_TEMPORARY_FOLDERS: readonly RegExp[] = [
  /~(?:\\+|\/+)AppData(?:\\+|\/+)Local(?:\\+|\/+)Temp(?![\w.-])/giu,
  /\b[a-z]:(?:\\+|\/+)Windows(?:\\+|\/+)Temp(?![\w.-])/giu,
]

function withoutWindowsTemporaryFolders(text: string) {
  return WINDOWS_TEMPORARY_FOLDERS.reduce(
    (scrubbed, pattern) => scrubbed.replace(pattern, TEMPORARY),
    text,
  )
}

/** Replaces home directories, temporary and scratch folders in `text`. */
export function scrubPaths(text: string) {
  return withoutWindowsTemporaryFolders(scrubErrorReportPaths(text))
}

/** Every rule: paths first, then UUIDs and long hex runs. */
export function scrubReportText(text: string) {
  return withoutWindowsTemporaryFolders(scrubErrorReportText(text))
}
