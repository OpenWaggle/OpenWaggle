export function topLevelCliUsage(version: string) {
  return `OpenWaggle ${version}

Usage:
  openwaggle                    Open the desktop app, or focus it if it is already open
  openwaggle <path>             Open the desktop app on a project (a file opens its folder)
  openwaggle <command> [args]   Run a command without opening the desktop app

Commands:
  run          Run an agent in a project and stream its reply to the terminal
  status       Show whether the Session Host is running and which runs are active
  host         Check on or stop the background Session Host
  sessions     Find, start, message, steer, wait for, and export Sessions
  delegations  List, review, and resolve Worker Delegations
  agents       List, validate, and manage Agent definitions
  access       Manage named access profiles for agents and scripts
  mcp          Manage MCP servers, or serve OpenWaggle over MCP
  update       Check for and install OpenWaggle updates
  recovery     Inspect or restore the pre-migration database copy
  help         Show help for a command

Options:
  -h, --help         Show this help
  -v, -V, --version  Print the OpenWaggle version

Commands run in the background Session Host, which starts on demand and keeps
running while work is active. Sessions started from the terminal appear in the
desktop app whenever it is open.

Run 'openwaggle help <command>' or 'openwaggle <command> --help' for details.`
}
