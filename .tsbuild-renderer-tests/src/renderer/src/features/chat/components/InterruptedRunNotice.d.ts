import type { RunMode } from '@shared/types/background-run';
import type { SessionBranchId } from '@shared/types/brand';
import type { SupportedModelId } from '@shared/types/llm';
interface InterruptedRunNoticeProps {
    readonly runId: string;
    readonly branchId: SessionBranchId;
    readonly runMode: RunMode;
    readonly model: SupportedModelId;
    readonly interruptedAt: number;
    readonly onDismiss?: (runId: string, branchId: SessionBranchId) => void;
}
export declare function InterruptedRunNotice({ runId, branchId, runMode, model, interruptedAt, onDismiss, }: InterruptedRunNoticeProps): import("node_modules/@types/react").JSX.Element;
export {};
