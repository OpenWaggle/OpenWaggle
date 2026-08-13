import { jsx as _jsx } from "react/jsx-runtime";
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useComposerStore } from '@/features/composer/state';
import { useSessionStore } from '@/features/sessions/state';
import { groupSessionsByProject } from '@/features/sidebar/lib';
import { archivedSessionBranchesQueryOptions, archivedSessionsQueryOptions, useArchivedDeleteSessionMutation, useRestoreSessionBranchMutation, useUnarchiveSessionMutation, } from '@/queries/archived-sessions';
import { api } from '@/shared/lib/ipc';
import { ArchivedEmptyState } from './ArchivedEmptyState';
import { ArchivedErrorAlert } from './ArchivedErrorAlert';
import { ArchivedSectionContent } from './ArchivedSectionContent';
import { groupArchivedBranchesByProject } from './archived-branch-groups';
function describeArchivedError(error, fallback) {
    return error instanceof Error && error.message.trim() ? error.message : fallback;
}
function getArchivedQueryError(archivedError, archivedBranchesError) {
    if (archivedError) {
        return describeArchivedError(archivedError, 'Failed to load archived sessions.');
    }
    if (archivedBranchesError) {
        return describeArchivedError(archivedBranchesError, 'Failed to load archived branches.');
    }
    return null;
}
export function ArchivedSection() {
    const archivedQuery = useQuery(archivedSessionsQueryOptions());
    const archivedBranchesQuery = useQuery(archivedSessionBranchesQueryOptions());
    const unarchiveMutation = useUnarchiveSessionMutation();
    const restoreBranchMutation = useRestoreSessionBranchMutation();
    const deleteMutation = useArchivedDeleteSessionMutation();
    const loadSessions = useSessionStore((state) => state.loadSessions);
    const [actionError, setActionError] = useState(null);
    function handleRestore(id) {
        setActionError(null);
        void unarchiveMutation
            .mutateAsync(id)
            .then(() => {
            void loadSessions();
        })
            .catch((error) => {
            setActionError(describeArchivedError(error, 'Failed to restore archived session.'));
        });
    }
    function handleRestoreBranch(sessionId, branchId) {
        setActionError(null);
        void restoreBranchMutation
            .mutateAsync({ sessionId, branchId })
            .then(() => {
            void loadSessions();
        })
            .catch((error) => {
            setActionError(describeArchivedError(error, 'Failed to restore archived branch.'));
        });
    }
    function handleDelete(id) {
        setActionError(null);
        void api
            .showConfirm('Delete permanently?', 'This session will be permanently deleted. This cannot be undone.')
            .then((confirmed) => {
            if (!confirmed)
                return;
            void deleteMutation
                .mutateAsync(id)
                .then(() => {
                useComposerStore.getState().clearScopedDraftsForSession(String(id));
            })
                .catch((error) => {
                setActionError(describeArchivedError(error, 'Failed to permanently delete archived session.'));
            });
        })
            .catch((error) => {
            setActionError(describeArchivedError(error, 'Failed to open delete confirmation.'));
        });
    }
    if (archivedQuery.isPending || archivedBranchesQuery.isPending) {
        return (_jsx("div", { className: "flex items-center justify-center py-20 text-text-muted text-[13px]", children: "Loading archived sessions\u2026" }));
    }
    const archived = archivedQuery.data ?? [];
    const archivedBranchSessions = archivedBranchesQuery.data ?? [];
    const queryError = getArchivedQueryError(archivedQuery.error, archivedBranchesQuery.error);
    const hasArchivedItems = archived.length > 0 || archivedBranchSessions.length > 0;
    if (queryError && !hasArchivedItems) {
        return (_jsx("div", { className: "flex items-center justify-center py-20", children: _jsx(ArchivedErrorAlert, { message: queryError }) }));
    }
    if (!hasArchivedItems) {
        return _jsx(ArchivedEmptyState, {});
    }
    return (_jsx(ArchivedSectionContent, { groups: groupSessionsByProject(archived), branchGroups: groupArchivedBranchesByProject(archivedBranchSessions), actionError: actionError, queryError: queryError, onRestore: handleRestore, onDelete: handleDelete, onRestoreBranch: handleRestoreBranch }));
}
