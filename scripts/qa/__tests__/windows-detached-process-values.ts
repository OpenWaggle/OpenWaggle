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
] as const

export const WINDOWS_DETACHED_PROCESS_SENTINEL_KEY = 'OPENWAGGLE_DETACHED_PROBE_SENTINEL'
