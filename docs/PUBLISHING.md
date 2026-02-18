# Publishing condukt-ai

## Preconditions

- npm account authenticated (`pnpm npm whoami`)
- package name availability checked (`pnpm npm view condukt-ai`)
- clean git state

## 1) Validate release locally

```bash
pnpm install
pnpm --filter condukt-ai release:check
```

This runs:
- lint
- typecheck
- tests
- build
- release identity guard
- `pnpm pack` artifact check

## 2) Bump version

```bash
pnpm --filter condukt-ai version patch
```

Use `minor`/`major` when needed.

## 3) Publish

```bash
pnpm --filter condukt-ai publish --access public --provenance --no-git-checks
```

Or use GitHub Actions manual workflow:
- run `publish`
- ensure repo secret `NPM_TOKEN` is configured

## 4) Verify install

```bash
pnpm dlx tsx -e "import('condukt-ai').then(m => console.log(Object.keys(m).slice(0,8)))"
```

## Release notes template

- Added:
- Changed:
- Fixed:
- Breaking:
