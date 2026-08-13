import { jsxs as _jsxs, jsx as _jsx } from "react/jsx-runtime";
import { Button } from '@/shared/ui/Button';
const STUB_SELECTED_LINE = 8;
export function StubCodeView({ items, renderAnnotation, onSelectedLinesChange, }) {
    return (_jsx("div", { "data-testid": "code-view", children: items.map((item) => (_jsxs("div", { children: [_jsxs(Button, { variant: "unstyled", type: "button", onClick: () => onSelectedLinesChange?.({
                        id: item.id,
                        range: {
                            start: STUB_SELECTED_LINE,
                            end: STUB_SELECTED_LINE,
                            side: 'additions',
                        },
                    }), children: ["select ", item.fileDiff.name] }), (item.annotations ?? []).map((annotation) => (_jsx("div", { children: renderAnnotation?.(annotation, item) }, `${annotation.side}:${String(annotation.lineNumber)}:${annotation.metadata?.kind ?? ''}`)))] }, item.id))) }));
}
export const SAMPLE_DIFF = `diff --git a/src/app.ts b/src/app.ts
index 111..222 100644
--- a/src/app.ts
+++ b/src/app.ts
@@ -1,8 +1,8 @@
 const one = 1
 const two = 2
 const three = 3
 const four = 4
-const old line = 5
+new line
 const six = 6
 const seven = 7
 const eight = 8`;
export function fileDiff(path = 'src/app.ts') {
    return { path, diff: SAMPLE_DIFF, additions: 1, deletions: 1 };
}
export function gitStatus(changedFiles) {
    return {
        branch: 'main',
        additions: 1,
        deletions: 1,
        filesChanged: changedFiles.length,
        changedFiles,
        clean: changedFiles.length === 0,
        ahead: 0,
        behind: 0,
    };
}
