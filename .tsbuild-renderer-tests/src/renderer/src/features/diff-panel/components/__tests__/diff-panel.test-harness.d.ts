import type { GitStatusSummary } from '@shared/types/git';
import type { ReactNode } from 'react';
/**
 * Shared harness for diff-panel component tests.
 *
 * CodeView is a measurement-driven renderer (Shiki, virtualization,
 * ResizeObserver) and does not render meaningfully under jsdom, so it is stubbed
 * to exercise OUR wiring -- items, annotations, and selection plumbing. The real
 * renderer is verified in the Electron app.
 */
export interface StubAnnotation {
    readonly side: string;
    readonly lineNumber: number;
    readonly metadata?: {
        readonly kind: string;
        readonly commentId?: string;
    };
}
interface StubCodeViewProps {
    items: readonly {
        id: string;
        fileDiff: {
            name: string;
        };
        annotations?: readonly StubAnnotation[];
    }[];
    renderAnnotation?: (annotation: StubAnnotation, item: unknown) => ReactNode;
    onSelectedLinesChange?: (selection: {
        id: string;
        range: {
            start: number;
            end: number;
            side: string;
        };
    }) => void;
}
export declare function StubCodeView({ items, renderAnnotation, onSelectedLinesChange, }: StubCodeViewProps): import("node_modules/@types/react").JSX.Element;
export declare const SAMPLE_DIFF = "diff --git a/src/app.ts b/src/app.ts\nindex 111..222 100644\n--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1,8 +1,8 @@\n const one = 1\n const two = 2\n const three = 3\n const four = 4\n-const old line = 5\n+new line\n const six = 6\n const seven = 7\n const eight = 8";
export declare function fileDiff(path?: string): {
    path: string;
    diff: string;
    additions: number;
    deletions: number;
};
export declare function gitStatus(changedFiles: GitStatusSummary['changedFiles']): GitStatusSummary;
export {};
