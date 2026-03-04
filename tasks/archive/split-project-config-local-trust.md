# Split Project Config Into Shared + Local-Only (No Migration)

## Scope

- Move `writeFile` trust persistence from `.openwaggle/config.toml` to `.openwaggle/config.local.toml`.
- Keep quality overrides in `.openwaggle/config.toml`.
- Auto-add `.openwaggle/config.local.toml` to git local excludes (`.git/info/exclude`) when possible.
- Document shared vs local config behavior.

## Checklist

- [x] Add separate shared/local config schemas in `src/shared/schemas/validation.ts`.
- [x] Refactor `src/main/config/project-config.ts` to load shared + local files and merge output.
- [x] Route `setWriteFileTrust(...)` writes to local config only.
- [x] Add `ensureLocalProjectConfigFile(...)` and preserve `ensureProjectConfigFile(...)` for shared config.
- [x] Implement best-effort git exclude helper handling `.git` directory and `gitdir:` pointer file.
- [x] Add `.openwaggle/config.local.toml` to root `.gitignore`.
- [x] Update docs:
  - [x] `docs/configuration.md`
  - [x] `docs/user-guide/configuration.md`
- [x] Expand unit tests in `src/main/config/project-config.unit.test.ts`.
- [x] Add integration coverage in `src/main/config/project-config.integration.test.ts`.
- [x] Run full verification (`pnpm typecheck`, `pnpm lint`, `pnpm test:unit`, `pnpm test:integration`).

## Review Notes

- No migration logic added by design (app unreleased).
- Local trust scope remains `approvals.tools.writeFile` only.
- Verification completed successfully:
  - `pnpm typecheck`
  - `pnpm lint`
  - `pnpm test:unit`
  - `pnpm test:integration`
