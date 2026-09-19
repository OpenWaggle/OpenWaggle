const JSON_INDENT_SPACES = 2

export function reportSessionDiscoveryBenchmarkResult(result: unknown, passed: boolean) {
  process.stdout.write(`${JSON.stringify(result, null, JSON_INDENT_SPACES)}\n`)
  if (!passed) process.exitCode = 1
}
