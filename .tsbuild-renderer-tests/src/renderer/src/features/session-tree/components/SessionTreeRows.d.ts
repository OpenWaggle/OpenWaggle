import type { SessionTreeRowActions, SessionTreeRowRefs, SessionTreeRowsView } from '../model';
interface SessionTreeRowsProps {
    readonly actions: SessionTreeRowActions;
    readonly refs: SessionTreeRowRefs;
    readonly view: SessionTreeRowsView;
}
export declare function SessionTreeRows({ actions, refs, view }: SessionTreeRowsProps): import("node_modules/@types/react").JSX.Element;
export {};
