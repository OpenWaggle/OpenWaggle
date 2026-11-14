/** What the preload answers when a terminal pane attaches to a ready, running shell. */
export const attachResult = () => ({
  inputIncarnation: 'native-record-1',
  history: '',
  outputBytes: 0,
  outputGeneration: 1,
  readiness: { phase: 'ready' as const, generation: 1 },
  running: true,
})
