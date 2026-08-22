// Shared draft shapes for Manage Atlas add/edit forms. Drafts are UI-shaped
// (strings for number/date-ish fields) and are converted to domain records at
// save time in the flow components.
//
// The to-draft converters here are also used by Direct Edit (v1.1): the Detail
// Sheet turns an existing Visit/Wishlist record back into a draft, and the
// equality helpers decide whether an edit is dirty. Keeping a single copy of
// this round-trip logic means inline editing can never drift from Manage Atlas.
import type { InspirationType, Season, Visit, VisitType, Wishlist } from "../../lib/types";

export interface VisitDraft {
  visitType: VisitType;
  startDate: string;
  endDate: string;
  withFriends: boolean;
  highlights: { name: string; note: string }[];
  reflection: string;
  mediaIds: string[];
}

export function emptyVisitDraft(): VisitDraft {
  return {
    visitType: "trip",
    startDate: "",
    endDate: "",
    withFriends: false,
    highlights: [],
    reflection: "",
    mediaIds: [],
  };
}

/** Existing Visit record → UI draft (the inverse of visitFromDraft in save.ts). */
export function visitToDraft(v: Visit): VisitDraft {
  return {
    visitType: v.visitType,
    startDate: v.startDate ?? "",
    endDate: v.endDate ?? "",
    withFriends: v.withFriends ?? false,
    highlights: (v.highlights ?? []).map((h) => ({ name: h.name, note: h.note ?? "" })),
    reflection: v.reflection ?? "",
    mediaIds: v.mediaIds ?? [],
  };
}

export interface InspirationDraft {
  type: InspirationType;
  title: string;
  creator: string;
  platform: string;
  url: string;
  note: string;
}

export function emptyInspiration(): InspirationDraft {
  return { type: "book", title: "", creator: "", platform: "", url: "", note: "" };
}

export interface WishlistDraft {
  seasons: Season[];
  targetYear: string;
  targetSeason: "" | Season;
  priority: string;
  why: string;
  note: string;
  inspirations: InspirationDraft[];
  mediaIds: string[];
}

export function emptyWishlistDraft(): WishlistDraft {
  return {
    seasons: [],
    targetYear: "",
    targetSeason: "",
    priority: "",
    why: "",
    note: "",
    inspirations: [],
    mediaIds: [],
  };
}

/** Existing Wishlist record → UI draft (the inverse of wishlistFromDraft in save.ts). */
export function wishlistToDraft(w: Wishlist): WishlistDraft {
  return {
    seasons: w.seasons ?? [],
    targetYear: w.targetTime?.year != null ? String(w.targetTime.year) : "",
    targetSeason: w.targetTime?.season ?? "",
    priority: w.priority != null ? String(w.priority) : "",
    why: w.why ?? "",
    note: w.note ?? "",
    inspirations: (w.inspirations ?? []).map((i) => ({
      type: i.type,
      title: i.title ?? "",
      creator: i.creator ?? "",
      platform: i.platform ?? "",
      url: i.url ?? "",
      note: i.note ?? "",
    })),
    mediaIds: w.mediaIds ?? [],
  };
}

function arraysEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

/** Deep equality used to decide whether a direct-edit draft differs from the
 * saved record (i.e. whether the sheet has unsaved changes). */
export function visitDraftEquals(a: VisitDraft, b: VisitDraft): boolean {
  return (
    a.visitType === b.visitType &&
    a.startDate === b.startDate &&
    a.endDate === b.endDate &&
    a.withFriends === b.withFriends &&
    a.reflection === b.reflection &&
    arraysEqual(a.mediaIds, b.mediaIds) &&
    a.highlights.length === b.highlights.length &&
    a.highlights.every(
      (h, i) => h.name === b.highlights[i].name && h.note === b.highlights[i].note
    )
  );
}

export function wishlistDraftEquals(a: WishlistDraft, b: WishlistDraft): boolean {
  return (
    a.seasons.length === b.seasons.length &&
    a.seasons.every((s, i) => s === b.seasons[i]) &&
    a.targetYear === b.targetYear &&
    a.targetSeason === b.targetSeason &&
    a.priority === b.priority &&
    a.why === b.why &&
    a.note === b.note &&
    arraysEqual(a.mediaIds, b.mediaIds) &&
    a.inspirations.length === b.inspirations.length &&
    a.inspirations.every(
      (i, idx) =>
        i.type === b.inspirations[idx].type &&
        i.title === b.inspirations[idx].title &&
        i.creator === b.inspirations[idx].creator &&
        i.platform === b.inspirations[idx].platform &&
        i.url === b.inspirations[idx].url &&
        i.note === b.inspirations[idx].note
    )
  );
}
