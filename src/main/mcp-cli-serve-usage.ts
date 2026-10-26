import { OPENWAGGLE_MCP_SERVE_GRANTS } from './openwaggle-mcp-server-policy'

/** `openwaggle mcp serve --help` (#350). */
export function serveUsage() {
  return `OpenWaggle MCP server

Serves the openwaggle_hive tool to another MCP client.

Usage:
  openwaggle mcp serve --stdio (--profile <name> | --owner) --grant <capability>...
                       (--workspace <path> | --session <id>)... [options]
  openwaggle mcp serve --http <port> --token-stdin (--profile <name> | --owner)
                       --grant <capability>... (--workspace <path> | --session <id>)... [options]

Authority (exactly one):
  --profile <name>               Serve as the named access profile, authenticated with its
                                 stored credential. The server holds what both the profile
                                 and the options below allow. A revoked or unknown profile
                                 is refused.
  --owner                        Serve your own (desktop user) authority, limited to the
                                 options below. OpenWaggle agents cannot use it.

Grants and scope (required):
  --grant <capability>           A Session capability the server may use (repeatable,
                                 or comma-separated). Only granted operations are listed.
  --workspace <path>             A directory whose projects the server may reach (repeatable).
  --session <id>                 A Session the server may reach; a Session link works too.

Options:
  --profile-credential-file <path>
                                 Read the profile credential from this file instead of the
                                 credential store (also OPENWAGGLE_PROFILE_CREDENTIAL_FILE).
  --authorization-ceiling ask-for-approval|yolo
                                 With --owner only (default ask-for-approval). A profile
                                 server keeps the profile's ceiling.
  --export-root <path>           Where export-create may write (repeatable).
  --attachment-root <path>       Where attachments may be read from (repeatable).
  --origin-session <id>          The only Session report may name as its source.
  --token-stdin                  Read the HTTP bearer token (at least 32 bytes) from stdin.

Supported grants: ${OPENWAGGLE_MCP_SERVE_GRANTS.join(', ')}.
`
}
