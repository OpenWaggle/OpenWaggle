import { jsx as _jsx } from "react/jsx-runtime";
import { CodeView } from '@pierre/diffs/react';
import { useCallback, useMemo, useState } from 'react';
import { buildCodeViewItems, } from '@/features/diff-panel/lib/code-view-items';
import { Spinner } from '@/shared/ui/Spinner';
import { InlineComment } from './InlineComment';
import { PendingComment } from './PendingComment';
const CODE_VIEW_LAYOUT = { paddingTop: 10, paddingBottom: 10, gap: 10 };
/**
 * Annotations anchor to the additions side unless the comment targets a removed
 * line: a review of the agent's work is almost always about the new code.
 */
function annotationSide(lineType) {
    return lineType === 'remove' ? 'deletions' : 'additions';
}
function buildAnnotationsByPath(comments, draft) {
    const byPath = new Map();
    const push = (filePath, annotation) => {
        const existing = byPath.get(filePath);
        if (existing === undefined) {
            byPath.set(filePath, [annotation]);
            return;
        }
        existing.push(annotation);
    };
    for (const comment of comments) {
        push(comment.filePath, {
            side: 'additions',
            lineNumber: comment.endLine,
            metadata: { kind: 'pending', filePath: comment.filePath, commentId: comment.id },
        });
    }
    if (draft !== null) {
        push(draft.filePath, {
            side: annotationSide(draft.lineType),
            lineNumber: draft.endLine ?? draft.line,
            metadata: { kind: 'draft', filePath: draft.filePath },
        });
    }
    return byPath;
}
function filePathOfItem(item) {
    return item.type === 'diff' ? item.fileDiff.name : item.file.name;
}
export function DiffCodeView({ viewerRef, files, isLoading, viewOptions, review, }) {
    const { comments, activeCommentLocation, onSetActiveComment, onAddSingleComment, onAddToReview, onRemoveComment, } = review;
    const [selection, setSelection] = useState(null);
    const patchByPath = useMemo(() => {
        const map = new Map();
        for (const file of files)
            map.set(file.path, file.diff);
        return map;
    }, [files]);
    const items = useMemo(() => buildCodeViewItems(files, buildAnnotationsByPath(comments, activeCommentLocation)), [files, comments, activeCommentLocation]);
    const options = useMemo(() => ({
        theme: viewOptions.syntaxTheme,
        diffStyle: viewOptions.diffView,
        overflow: viewOptions.wrapLines ? 'wrap' : 'scroll',
        stickyHeaders: true,
        enableLineSelection: true,
        layout: CODE_VIEW_LAYOUT,
    }), [viewOptions.syntaxTheme, viewOptions.diffView, viewOptions.wrapLines]);
    const renderAnnotation = useCallback((annotation, item) => {
        const metadata = annotation.metadata;
        if (metadata === undefined)
            return null;
        if (metadata.kind === 'pending') {
            const comment = comments.find((c) => c.id === metadata.commentId);
            if (comment === undefined)
                return null;
            return _jsx(PendingComment, { comment: comment, onRemove: () => onRemoveComment(comment.id) });
        }
        const location = activeCommentLocation;
        if (location === null || location.filePath !== filePathOfItem(item))
            return null;
        return (_jsx(InlineComment, { startLine: location.line, endLine: location.endLine ?? location.line, hasPendingReview: comments.length > 0, onAddSingleComment: (content) => onAddSingleComment(location, content), onAddToReview: (content) => onAddToReview(location, content), onCancel: () => onSetActiveComment(null) }));
    }, [
        comments,
        activeCommentLocation,
        onAddSingleComment,
        onAddToReview,
        onRemoveComment,
        onSetActiveComment,
    ]);
    const handleSelectionChange = useCallback((next) => {
        setSelection(next);
        if (next === null) {
            onSetActiveComment(null);
            return;
        }
        const filePath = [...patchByPath.keys()].find((path) => next.id.endsWith(path));
        if (filePath === undefined)
            return;
        const start = Math.min(next.range.start, next.range.end);
        const end = Math.max(next.range.start, next.range.end);
        onSetActiveComment({
            filePath,
            line: start,
            endLine: end,
            lineType: next.range.side === 'deletions' ? 'remove' : 'add',
        });
    }, [onSetActiveComment, patchByPath]);
    if (isLoading) {
        return (_jsx("div", { className: "flex flex-1 items-center justify-center", children: _jsx(Spinner, {}) }));
    }
    if (files.length === 0) {
        return (_jsx("div", { className: "flex flex-1 items-center justify-center text-[12px] text-text-tertiary", children: "No changes to review" }));
    }
    return (_jsx(CodeView, { ref: viewerRef, className: "diff-chrome diff-scroll min-h-0 min-w-0 flex-1 overflow-auto", items: items, options: options, selectedLines: selection, onSelectedLinesChange: handleSelectionChange, renderAnnotation: renderAnnotation }));
}
