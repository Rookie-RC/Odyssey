// Shared contextual focus for Map ↔ Timeline synchronization (v1.3).
//
// One state, two views: whichever side initiated the focus is recorded in
// `source`, so the other side responds without echoing back — the feedback-
// loop guard. Components only ever *emit* a focus from a real user
// interaction (click/select); programmatic emphasis is a one-way prop, so
// Map → Timeline → Map recursion is impossible by construction.
export interface SyncFocus {
  placeId: string;
  /** Journey Timeline node id ("visit:…", "now:…", "wishlist:…"). */
  nodeId: string;
  /** Visit id when the focused node is a Visit (drives the multiple-Visit
   * rule and residence-route segment emphasis). */
  visitId?: string;
  source: "timeline" | "map";
}
