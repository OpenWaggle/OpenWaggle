import type { SessionTreeFilterMode } from '@shared/types/session';
export declare const SESSION_TREE: {
    FILTER_OPTIONS: readonly [{
        readonly value: "default";
        readonly label: "Default";
    }, {
        readonly value: "no-tools";
        readonly label: "No tools";
    }, {
        readonly value: "user-only";
        readonly label: "User only";
    }, {
        readonly value: "labeled-only";
        readonly label: "Labeled";
    }, {
        readonly value: "all";
        readonly label: "All";
    }];
    LAYOUT: {
        NODE_DOT_SIZE_PX: number;
        NODE_DOT_OFFSET_PX: number;
        CONNECTOR_STROKE_WIDTH_PX: number;
        CONNECTOR_ACTIVE_STROKE: string;
        CONNECTOR_ACTIVE_FILTER: string;
        CONNECTOR_MUTED_STROKE: string;
        CONNECTOR_ANCESTOR_STROKE: string;
        GUTTER_START_PX: number;
        DEPTH_STEP_PX: number;
        GUTTER_END_PADDING_PX: number;
        ROW_HEIGHT_PX: number;
        ROW_CENTER_Y_PX: number;
        CONNECTOR_ROW_OVERLAP_PX: number;
        ROOT_VISUAL_DEPTH: number;
    };
    TRAVERSAL: {
        FIRST_INDEX: number;
        NEXT_ITEM_DELTA: number;
        PREVIOUS_ITEM_DELTA: number;
    };
};
export declare function isSessionTreeFilterMode(value: string): value is SessionTreeFilterMode;
