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
Policy: --authorization ask-for-approval|yolo (default ask-for-approval)
Managing other profiles (create and update of a profile with --capability access:profiles):
  --manage-capability <capability>... and either --manage-all or one or more of
  --manage-project <path>... --manage-session <id>... --manage-hive <root-id>...
  [--manage-export-root <path>...] [--manage-attachment-root <path>...]
  [--manage-authorization ask-for-approval|yolo] (default ask-for-approval)
  This Profile-management envelope bounds the profiles it may create or update. Without these
  options, update removes the profile's envelope.
Caller: --profile <name> [--credential-stdin|--profile-credential-file <path>]
Common: --idempotency-key <key> --json
Unknown, missing-value, command-inapplicable, unexpected positional, and -- passthrough input
fail before credentials or profiles change.`
}
