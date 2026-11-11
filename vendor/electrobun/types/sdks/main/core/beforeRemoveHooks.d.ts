export type BeforeRemoveHook = () => void;
/**
 * One-shot synchronous hooks for tearing down resources that still depend on
 * a native object. Errors are collected so every hook gets a chance to run.
 */
export declare class BeforeRemoveHooks {
    private readonly hooks;
    private didRun;
    subscribe(hook: BeforeRemoveHook): () => void;
    run(): unknown[];
}
