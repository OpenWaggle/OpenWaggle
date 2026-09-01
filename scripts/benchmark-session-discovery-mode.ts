const STANDARD_SESSION_COUNT = 100_000
const STANDARD_MESSAGE_COUNT = 10_000_000
const STANDARD_SKEWED_SESSION_MESSAGE_COUNT = 10_000
const SMOKE_SESSION_COUNT = 1_000
const SMOKE_MESSAGE_COUNT = 100_000
const SMOKE_SKEWED_SESSION_MESSAGE_COUNT = 1_000

export function sessionDiscoveryBenchmarkMode(arguments_: readonly string[]) {
  if (arguments_.includes('--smoke')) {
    return {
      name: 'smoke',
      sessionCount: SMOKE_SESSION_COUNT,
      messageCount: SMOKE_MESSAGE_COUNT,
      skewedSessionMessageCount: SMOKE_SKEWED_SESSION_MESSAGE_COUNT,
    } as const
  }
  if (arguments_.includes('--query-scale')) {
    return {
      name: 'query-scale',
      sessionCount: STANDARD_SESSION_COUNT,
      messageCount: STANDARD_SESSION_COUNT,
      skewedSessionMessageCount: SMOKE_SKEWED_SESSION_MESSAGE_COUNT,
    } as const
  }
  return {
    name: 'standard',
    sessionCount: STANDARD_SESSION_COUNT,
    messageCount: STANDARD_MESSAGE_COUNT,
    skewedSessionMessageCount: STANDARD_SKEWED_SESSION_MESSAGE_COUNT,
  } as const
}
