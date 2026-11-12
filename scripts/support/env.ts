/**
 * The environment repository scripts read, decoded from `process.env` with one schema so a script
 * reads `scriptEnv().NAME` instead of a key out of an arbitrary map [TS-06]. Every variable is an
 * optional string: scripts decide what an absent value means. `scriptEnv()` decodes at call time,
 * so a test that stubs a variable with `vi.stubEnv` sees it. An env map handed to a child process
 * stays a `NodeJS.ProcessEnv`.
 */
import { decodeUnknownOrThrow, Schema, type SchemaType } from '@shared/schema'

// explicit undefined: a process.env key can be present and undefined (Bun and vitest set TZ so).
const optionalString = Schema.optional(Schema.String)

const scriptEnvSchema = Schema.Struct({
  ACTIONS_ID_TOKEN_REQUEST_TOKEN: optionalString,
  ACTIONS_ID_TOKEN_REQUEST_URL: optionalString,
  APPDATA: optionalString,
  AWS_DEFAULT_REGION: optionalString,
  AWS_REGION: optionalString,
  BENCH_PROXY_TOKEN: optionalString,
  CHECK_CONCURRENCY: optionalString,
  CI: optionalString,
  COVERAGE_UNIQUENESS_INDEX: optionalString,
  DISPLAY: optionalString,
  DOCS_STYLE_ONLY: optionalString,
  EXPECTED_ARTIFACT_RUN_ID: optionalString,
  EXPECTED_ARTIFACT_SOURCE_SHA: optionalString,
  GH_TOKEN: optionalString,
  GITHUB_ACTIONS: optionalString,
  GITHUB_ENV: optionalString,
  GITHUB_EVENT_NAME: optionalString,
  GITHUB_OUTPUT: optionalString,
  GITHUB_REF: optionalString,
  GITHUB_REPOSITORY: optionalString,
  GITHUB_SHA: optionalString,
  GITHUB_STEP_SUMMARY: optionalString,
  HOME: optionalString,
  MCP_CONFORMANCE_PROTOCOL_VERSION: optionalString,
  MCP_CONFORMANCE_SCENARIO: optionalString,
  NODE_OPTIONS: optionalString,
  OPENWAGGLE_AUTOMATION_FIRST_PARTY_EXTENSIONS: optionalString,
  OPENWAGGLE_AUTOMATION_PI_EXTENSIONS: optionalString,
  OPENWAGGLE_AUTOMATION_PROJECT_MCP: optionalString,
  OPENWAGGLE_COMMIT_POLICY_BASELINE: optionalString,
  OPENWAGGLE_COMPILE_CACHE_DIR: optionalString,
  OPENWAGGLE_EVIDENCE_DIR: optionalString,
  OPENWAGGLE_HOST_TMPDIR: optionalString,
  OPENWAGGLE_LIVE_MODEL: optionalString,
  OPENWAGGLE_LIVE_TIMEOUT_MS: optionalString,
  OPENWAGGLE_PACKAGE_BROWSER_EXECUTABLE: optionalString,
  OPENWAGGLE_PACKAGE_BROWSER_SMOKE: optionalString,
  OPENWAGGLE_PACKAGE_SMOKE_REQUIRED_MANAGERS: optionalString,
  OPENWAGGLE_PERF_BEDROCK_CALLS: optionalString,
  OPENWAGGLE_PERF_BEDROCK_MODEL: optionalString,
  OPENWAGGLE_PERF_OUT: optionalString,
  OPENWAGGLE_PERF_PREFIX_OUT: optionalString,
  OPENWAGGLE_PERF_PREFIX_PROJECT: optionalString,
  OPENWAGGLE_PERF_PREFIX_SECOND_REQUEST_MS: optionalString,
  OPENWAGGLE_QA_CDP_PORT: optionalString,
  OPENWAGGLE_QA_CLI_BOUNDARY_DIR: optionalString,
  OPENWAGGLE_QA_FIXTURE_ROOT: optionalString,
  OPENWAGGLE_USER_DATA_DIR: optionalString,
  OWPERF_COMPILE_CACHE_DIR: optionalString,
  OWPERF_KEEP_PROFILE: optionalString,
  OWPERF_LOG_LEVEL: optionalString,
  PATH: optionalString,
  PATHEXT: optionalString,
  PI_CODING_AGENT_DIR: optionalString,
  PI_CODING_AGENT_SESSION_DIR: optionalString,
  RECOVERY_RELEASE_SHA: optionalString,
  REQUIRE_NSIS: optionalString,
  SYNTAX_BENCHMARK_PROFILE: optionalString,
  TEMP: optionalString,
  TMP: optionalString,
  TMPDIR: optionalString,
  TZ: optionalString,
  USERPROFILE: optionalString,
  XAUTHORITY: optionalString,
  XDG_CONFIG_HOME: optionalString,
})

export type ScriptEnv = SchemaType<typeof scriptEnvSchema>

/** The variables a script reads, decoded from `source` (the current `process.env` by default). */
export function scriptEnv(source: NodeJS.ProcessEnv = process.env): ScriptEnv {
  return decodeUnknownOrThrow(scriptEnvSchema, source)
}
