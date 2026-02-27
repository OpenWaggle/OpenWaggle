# Orchestration Executor Security

Orchestration executors (LLMs running sub-tasks) receive read-only tools via `createExecutorTools()` in `src/main/orchestration/project-context.ts`. These tools enforce a `.gitignore`-based security boundary to prevent sensitive data from leaking into executor context.

## How It Works

At tool creation time, `buildIgnorePatterns()` reads the project's `.gitignore` and converts it to fast-glob ignore patterns. Both `readFile` and `glob` tools respect these patterns:

| Tool       | Behavior                                                                 |
|------------|--------------------------------------------------------------------------|
| `readFile` | Blocks reads of ignored files. Returns a clear error message.            |
| `glob`     | Excludes ignored files from search results entirely.                     |

### Pattern Conversion

`.gitignore` patterns are converted as follows:

| `.gitignore` pattern | fast-glob equivalent | Example match           |
|----------------------|----------------------|-------------------------|
| `node_modules/`      | `node_modules/**`    | `node_modules/pkg/i.js` |
| `*.log`              | `**/*.log`           | `src/debug.log`         |
| `.env`               | `**/.env`            | `.env`                  |
| `/build`             | `build`              | `build/output.js`       |
| `src/generated`      | `src/generated`      | `src/generated`         |

### Always-Ignored

`.git/**` is always excluded regardless of `.gitignore` contents.

### Fallback

If no `.gitignore` exists, only `.git/**` is ignored. Files like `.env` would **not** be blocked in this case. Projects must have a `.gitignore` that covers sensitive files.

## What Gets Blocked

Typical patterns in a well-configured `.gitignore` protect:

- **Secrets**: `.env`, `.env.local`, `.env.production`, credentials files
- **Dependencies**: `node_modules/`, `vendor/`
- **Build artifacts**: `dist/`, `build/`, `out/`, `coverage/`
- **VCS internals**: `.git/` (always blocked)

## Regression Tests

`src/main/orchestration/project-context.security.unit.test.ts` contains dedicated regression tests. Any change to executor tool filtering must pass these tests. The test suite covers:

- `readFile` blocks `.env`, `.env.local`, `.env.production`, `node_modules/`, `.git/`
- `glob` excludes all of the above from search results
- Non-ignored files remain accessible
- Fallback behavior when no `.gitignore` exists

## Source Files

- `src/main/orchestration/project-context.ts` — `buildIgnorePatterns()`, `createExecutorTools()`
- `src/main/orchestration/project-context.security.unit.test.ts` — regression tests
- `src/main/orchestration/project-context.unit.test.ts` — general unit tests including `buildIgnorePatterns` parsing
