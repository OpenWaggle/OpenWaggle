export function accessCliUsage() {
  return `OpenWaggle agent access

Usage:
  openwaggle access profiles list [--include-revoked] [--json]
  openwaggle access profiles create <name> --capability <capability>... [scope]
    (--credential-store|--credential-file <path>) [--replace]
  openwaggle access profiles update <name> --capability <capability>... [scope]
  openwaggle access profiles rotate <name> (--credential-store|--credential-file <path>) [--replace]
  openwaggle access profiles revoke <name>

Scope: --all | --project <path>... | --session <id>... | --hive <root-id>...
  (a Session id may also be a Session link: openwaggle://sessions/<session-id>)
Export files: --export-root <path>... (explicit read/write roots; never implied by Session scope)
Attachments: --attachment-root <path>... (explicit file-read roots)
Policy: --authorization ask-for-approval|yolo [--management-envelope-json <json>]
Caller: --profile <name> [--credential-stdin|--profile-credential-file <path>]
Common: --idempotency-key <key> --json
Unknown, missing-value, command-inapplicable, unexpected positional, and -- passthrough input
fail before credentials or profiles change.`
}
