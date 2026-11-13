export const WINDOWS_DETACHED_PROCESS_ARGUMENTS = [
  '',
  'plain',
  'space separated',
  '"quoted"',
  'quote"inside',
  '\\',
  'C:\\folder with spaces\\',
  'backslash\\"quote',
  'double\\\\"quote',
  'C:\\工蜂\\workspace with spaces\\',
  'abeille 蜂 🐝',
  'tab\tseparated',
  // The helper quotes its request as a PowerShell single-quoted literal, so an apostrophe must
  // survive being doubled.
  "it's O'Brien",
  "''",
] as const

export const WINDOWS_DETACHED_PROCESS_SENTINEL_KEY = 'OPENWAGGLE_DETACHED_PROBE_SENTINEL'
