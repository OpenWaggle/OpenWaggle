import { openWaggleMcpExposure } from '@shared/utils/mcp-exposure'
import { getMcpToolExposure, type McpServerConfigBase } from './mcp-server-config'

/**
 * MCP exposure as OpenWaggle runs it (ADR 0051 amendment). A file's `direct`, for a server or a
 * tool, runs as `codemode`: every direct tool schema was sent with every request (about 22k
 * tokens a call for four common servers) while the model used them in 0.2% of calls. Files are
 * never rewritten, so the `pi` command still declares those tools.
 */
export function withOpenWaggleRuntimeExposure<Config extends McpServerConfigBase>(
  config: Config,
): Config {
  const { exposure, toolExposure } = config
  const directTool = Object.values(toolExposure ?? {}).includes('direct')
  if (exposure !== 'direct' && !directTool) return config
  return {
    ...config,
    ...(exposure === undefined ? {} : { exposure: openWaggleMcpExposure(exposure) }),
    ...(toolExposure
      ? {
          toolExposure: Object.fromEntries(
            Object.entries(toolExposure).map(([tool, value]) => [
              tool,
              openWaggleMcpExposure(value),
            ]),
          ),
        }
      : {}),
  }
}

/**
 * Undoes `withOpenWaggleRuntimeExposure` for a Run in which codemode cannot reach MCP tools (Pi's
 * `-builtin:codemode`, or `autoEnableCodemode: false` with codemode inactive): a file's `direct`
 * stays `direct` there, as before OpenWaggle ran it as `codemode`, so those tools stay callable
 * (review R5 P2-3, maintainer decision: keep direct when codemode is off). `file` is the server's
 * configuration as its file says it.
 */
export function withFileDirectExposure<Config extends McpServerConfigBase>(
  config: Config,
  file: Pick<McpServerConfigBase, 'exposure' | 'toolExposure'>,
): Config {
  const directTool = Object.values(file.toolExposure ?? {}).includes('direct')
  if (file.exposure !== 'direct' && !directTool) return config
  return {
    ...config,
    ...(file.exposure === 'direct' ? { exposure: 'direct' as const } : {}),
    ...(directTool && file.toolExposure ? { toolExposure: { ...file.toolExposure } } : {}),
  }
}

/**
 * The one exception to `withOpenWaggleRuntimeExposure`: a tool that opens an MCP App
 * (`_meta.ui.resourceUri`) is declared to the model, so the model calls it itself and the App
 * shows under that call. Only tools that would run as `codemode` change; hidden and deferred
 * tools keep their exposure (tool search declares a deferred tool once it loads it).
 */
export function withMcpAppToolsDeclared<Config extends McpServerConfigBase>(
  config: Config,
  appTools: Iterable<string>,
): Config {
  const declared = [...new Set(appTools)].filter(
    (tool) => getMcpToolExposure(config, tool) === 'codemode',
  )
  if (declared.length === 0) return config
  return {
    ...config,
    toolExposure: {
      ...config.toolExposure,
      ...Object.fromEntries(declared.map((tool) => [tool, 'direct' as const])),
    },
  }
}
