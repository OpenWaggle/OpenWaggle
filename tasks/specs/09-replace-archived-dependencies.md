# 09 — Replace Archived Dependencies

**Status:** Planned
**Priority:** P2
**Severity:** High
**Depends on:** None
**Origin:** H-06

---

## Problem

Two dependencies for attachment processing are effectively abandoned:

- `mammoth@1.11.0` — DOCX-to-HTML converter. Last release: 2021. Repository archived. No security patches.
- `pdf-parse@1.1.1` — PDF text extraction. Last release: 2019. Depends on old `pdfjs-dist`. No security patches.

Both process untrusted user-uploaded files, making them security-sensitive.

## Implementation

- [ ] Replace `pdf-parse` with `unpdf` (actively maintained, uses latest pdf.js) or `pdfjs-dist` directly
- [ ] Replace `mammoth` with `docx-preview` or `libreoffice-convert` for DOCX extraction
- [ ] If replacement is deferred, pin exact versions to prevent accidental upgrades to forks

## Files to Touch

- `package.json` — swap dependencies
- `src/main/ipc/attachments-handler.ts` — update import and API calls

## Tests

- Integration: PDF text extraction produces correct output
- Integration: DOCX text extraction produces correct output

## Risk if Skipped

Known vulnerabilities in PDF/DOCX parsing with no upstream fixes. Processing untrusted files with archived libraries is a security liability.
