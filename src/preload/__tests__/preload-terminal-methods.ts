/** Integrated terminals. */
export const PRELOAD_TERMINAL_METHODS = [
  'getTerminalActivitySnapshot',
  'openTerminal',
  'detachTerminal',
  'clearTerminal',
  'restartTerminal',
  'closeTerminal',
  'resizeTerminal',
  'writeTerminal',
  'sendTerminalInputNow',
  'acknowledgeTerminalOutput',
  'assessTerminalClose',
  'migrateTerminalOwner',
  'onTerminalEvent',
  'onTerminalActivitySnapshot',
] as const
