/**
 * The names of the surface through which agents, people, and MCP clients coordinate Sessions
 * (ADR 0053). One name and one action vocabulary for all three front doors: the Pi tool, the
 * `openwaggle hive` CLI, and the OpenWaggle MCP server's tool. The former `sessions`,
 * `openwaggle sessions`, and `openwaggle_sessions` names are not accepted anywhere.
 */
export const HIVE_TOOL_NAME = 'hive'
export const HIVE_CLI_COMMAND = 'hive'
export const HIVE_MCP_TOOL_NAME = 'openwaggle_hive'
