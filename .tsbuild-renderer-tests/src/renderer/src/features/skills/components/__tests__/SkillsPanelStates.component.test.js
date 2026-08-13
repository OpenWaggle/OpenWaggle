import { jsx as _jsx } from "react/jsx-runtime";
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { EmptySkillsState, NoProjectState } from '../SkillsPanelStates';
describe('SkillsPanelStates', () => {
    it('explains that project selection is required before skills can be managed', () => {
        render(_jsx(NoProjectState, {}));
        expect(screen.getByText('No project selected')).toBeInTheDocument();
        expect(screen.getByText('Select a project folder to manage AGENTS.md and project skills.')).toBeInTheDocument();
    });
    it('explains which project skill directories are empty', () => {
        render(_jsx(EmptySkillsState, {}));
        expect(screen.getByText('No skills found under `.openwaggle/skills` or `.agents/skills`.')).toBeInTheDocument();
    });
});
