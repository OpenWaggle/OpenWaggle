# 10-Minute Trace Walkthrough

Goal: show how quickly a broken agent step can be diagnosed from trace data.

## 1. Install and run happy path

```bash
pnpm install
pnpm --filter condukt-ai quickstart
```

This writes `packages/core/trace.quickstart.json`.

Confirm:
- `status` is `"ok"`
- all tasks are `"ok"`

## 2. Run intentionally broken path

```bash
pnpm --filter condukt-ai quickstart:broken
```

This run intentionally returns invalid `draft.claims` type (string instead of `string[]`).

Confirm in console output:
- `Status: failed`
- `Failed task: draft`
- `Error code: CONTRACT_OUTPUT_VIOLATION`

## 3. Diagnose from trace (no re-run required)

Open `packages/core/trace.quickstart.json` and inspect:
- `tasks[]` entry for `task == "draft"`
- `error_code`
- `contract_issues[]` path/message
- `raw_output`

You should see:
- contract path `claims`
- a type mismatch message
- exact broken payload in `raw_output`

## Why this matters

The diagnosis path is deterministic:
1. Find first `tasks[].status == "error"`.
2. Read `error_code` and `contract_issues`.
3. Fix that task boundary contract mismatch.

This is the core Condukt TS value proposition: contract failures are explicit and traceable at the exact task boundary.

To capture trial metrics for this run, feed the same trace into:

```bash
pnpm --filter condukt-ai trial:start --participant p1 --scenario quickstart-broken --mode condukt-ai --trace packages/core/trace.quickstart.json
```
