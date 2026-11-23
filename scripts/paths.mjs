// The paths the process distinguishes, in one place (the same file exists in walkflow and ftms-treadmill, where the lists are filled).
// The route store has no belt code and no trust-boundary code: a route is one file in routes/ and its spec, checked by the store
// checks and the route reviewer. The lists stay empty so scripts/agent-pipeline.mjs is the same file everywhere.

/** Belt code: none here. */
export const SAFETY = [];

/** Trust-boundary code: none here. */
export const TRUST = [];
