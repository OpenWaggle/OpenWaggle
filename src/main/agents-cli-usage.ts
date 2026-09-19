export const AGENTS_CLI_USAGE = `OpenWaggle Agent definitions

Usage:
  openwaggle agents list [--project <path>] [--json]
  openwaggle agents search <query> [--project <path>] [--json]
  openwaggle agents validate <file> [--json]
  openwaggle agents explain <name> [--project <path>] [--json]
  openwaggle agents create <file> --scope project|portable-project|user [--project <path>] [--json]
  openwaggle agents update <file> --scope project|portable-project|user [--project <path>]
    [--expected-digest <sha256>] [--json]
  openwaggle agents duplicate <source-name> <target-name> --scope <scope> [--project <path>]
  openwaggle agents delete <name> --scope <scope> [--project <path>] [--expected-digest <sha256>]
  openwaggle agents import <file> --from auto|openwaggle|codex|claude-code|cursor|gemini-cli|github-copilot|opencode
    --scope <scope> [--project <path>] [--source-name <name>] [--dry-run] [--replace]
    [--expected-digest <sha256>] [--json]
  openwaggle agents refresh <name> [--project <path>] [--dry-run] [--replace] [--json]

Unknown, missing-value, command-inapplicable, unexpected positional, and -- passthrough input
fail before files are read or changed. Multi-word search queries remain positional rest operands.
`
