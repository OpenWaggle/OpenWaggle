import { stashDraftWorktreePlan, useSessionContextRow, } from '@/features/git';
import { usePreferencesStore } from '@/features/settings/state';
/**
 * Wires the composer context strip (WS1b) and gates send: a worktree-mode first
 * send is blocked (with a toast) until a Worktree base ref is resolvable.
 */
export function useComposerSendGate(input) {
    const projectPath = usePreferencesStore((s) => s.settings.projectPath);
    const defaultEnvironmentMode = usePreferencesStore((s) => s.settings.defaultSessionEnvironmentMode);
    const strip = useSessionContextRow({
        sessionId: input.activeSessionId,
        projectPath,
        isFirstMessage: input.isFirstMessage,
        session: input.session,
        defaultEnvironmentMode,
    });
    const guardedSend = async (payload) => {
        // Both blocking outcomes stop the send. 'worktree-missing' additionally offers
        // recover-or-switch actions in the context row, so the user is not stuck.
        if (strip.sendPlan.kind === 'blocked' || strip.sendPlan.kind === 'worktree-missing') {
            input.onToast(strip.sendPlan.reason);
            return;
        }
        // Persist the resolved plan onto the draft key so the lazily-created session
        // (created inside onSend) is born with the user's pre-send choice.
        if (input.activeSessionId === null && projectPath) {
            stashDraftWorktreePlan(projectPath, {
                envMode: strip.envMode,
                baseRef: strip.baseRef,
                startFromOrigin: strip.startFromOrigin,
            });
        }
        await input.onSend(payload);
    };
    return { strip, guardedSend };
}
