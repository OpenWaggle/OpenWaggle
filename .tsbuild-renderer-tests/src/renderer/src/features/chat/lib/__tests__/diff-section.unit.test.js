import { SessionId } from '@shared/types/brand';
import { describe, expect, it, vi } from 'vitest';
import { buildDiffSection } from '../diff-section';
const SESSION_ID = SessionId('session-1');
const PROJECT_PATH = '/repo/openwaggle';
const WORKTREE_PATH = '/wt/openwaggle/session-1';
function build(activeSession, projectPath = PROJECT_PATH) {
    return buildDiffSection({
        activeSession,
        projectPath,
        sessionId: SESSION_ID,
        onSendMessage: vi.fn(),
    });
}
describe('buildDiffSection', () => {
    /**
     * The defect ADR 0016 fixed: the agent edits files in its Session worktree while the
     * panel read the opened checkout, so the diff reported "No changes to review" during a
     * turn that was actively writing files. The working path must be the worktree.
     */
    it('points the panel at the Session worktree in worktree mode', () => {
        const section = build({ environmentMode: 'worktree', worktreePath: WORKTREE_PATH });
        expect(section.workingPath).toBe(WORKTREE_PATH);
    });
    /**
     * The repository identity is kept separately so the panel can tell a worktree apart
     * from the opened checkout and name which one it shows. If this collapsed onto the
     * working path the header would claim "Opened checkout" for every worktree session.
     */
    it('keeps the repository path distinct from the working path', () => {
        const section = build({ environmentMode: 'worktree', worktreePath: WORKTREE_PATH });
        expect(section.repositoryPath).toBe(PROJECT_PATH);
        expect(section.repositoryPath).not.toBe(section.workingPath);
    });
    it('uses the opened checkout for local-mode sessions', () => {
        const section = build({ environmentMode: 'local', worktreePath: null });
        expect(section.workingPath).toBe(PROJECT_PATH);
        expect(section.repositoryPath).toBe(PROJECT_PATH);
    });
    // A worktree path recorded on a session that has been switched back to local mode must
    // not be resurrected: the session runs in the checkout, so the panel must read it.
    it('ignores a recorded worktree path when the session is in local mode', () => {
        const section = build({ environmentMode: 'local', worktreePath: WORKTREE_PATH });
        expect(section.workingPath).toBe(PROJECT_PATH);
    });
    it('falls back to the opened checkout when no session is active', () => {
        const section = build(null);
        expect(section.workingPath).toBe(PROJECT_PATH);
        expect(section.repositoryPath).toBe(PROJECT_PATH);
    });
    it('carries a null project through without inventing a path', () => {
        const section = build(null, null);
        expect(section.workingPath).toBeNull();
        expect(section.repositoryPath).toBeNull();
    });
});
