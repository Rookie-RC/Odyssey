// Persistence helpers shared by AddFlow and the section editors. They convert
// UI drafts into domain records and enforce Place reuse: an existing matching
// Place is referenced directly; otherwise a new Place is created first, so a
// Visit and a Wishlist for the same location never create duplicate Places.
import type { Place, Visit, Wishlist } from "../../lib/types";
import type { AtlasRepository } from "../../lib/repository";
import type { ResolvedLocation } from "./LocationPicker";
import type { VisitDraft, WishlistDraft } from "./drafts";

export interface SavedEntity {
  placeId: string;
  placeCreated: boolean;
}

export async function resolvePlaceId(
  repo: AtlasRepository,
  resolved: ResolvedLocation
): Promise<SavedEntity> {
  if (resolved.existing) return { placeId: resolved.existing.id, placeCreated: false };
  const draft: Place = {
    id: "", // runtime generates the id
    name: resolved.draft.name,
    country: resolved.draft.country,
    countryCode: resolved.draft.countryCode,
    type: resolved.draft.type,
    coordinates: resolved.draft.coordinates,
  };
  const created = await repo.createPlace(draft);
  return { placeId: created.id, placeCreated: true };
}

export function visitFromDraft(draft: VisitDraft, placeId: string, existing?: Visit): Visit {
  const visit: Visit = {
    id: existing?.id ?? "",
    placeId,
    visitType: draft.visitType,
    withFriends: draft.withFriends || undefined,
    highlights: draft.highlights
      .filter((h) => h.name.trim())
      .map((h) => ({
        name: h.name.trim(),
        note: h.note.trim() ? h.note.trim() : undefined,
      })),
    mediaIds: draft.mediaIds.length > 0 ? draft.mediaIds : undefined,
    reflection: draft.reflection.trim() ? draft.reflection.trim() : undefined,
  };
  if (draft.startDate) visit.startDate = draft.startDate;
  if (draft.endDate) visit.endDate = draft.endDate;
  return visit;
}

export function wishlistFromDraft(
  draft: WishlistDraft,
  placeId: string,
  existing?: Wishlist
): Wishlist {
  const targetTime: Wishlist["targetTime"] =
    draft.targetYear.trim() !== "" || draft.targetSeason !== ""
      ? {
          year: draft.targetYear.trim() !== "" ? Number(draft.targetYear) : undefined,
          season: draft.targetSeason !== "" ? draft.targetSeason : undefined,
        }
      : undefined;
  const item: Wishlist = {
    id: existing?.id ?? "",
    placeId,
    seasons: draft.seasons.length > 0 ? draft.seasons : undefined,
    targetTime,
    priority:
      draft.priority.trim() !== ""
        ? (Number(draft.priority) as 1 | 2 | 3 | 4 | 5)
        : undefined,
    why: draft.why.trim() ? draft.why.trim() : undefined,
    note: draft.note.trim() ? draft.note.trim() : undefined,
    inspirations: draft.inspirations
      .filter((i) => i.title.trim() || i.creator.trim() || i.platform.trim() || i.url.trim() || i.note.trim())
      .map((i) => ({
        type: i.type,
        title: i.title.trim() || undefined,
        creator: i.creator.trim() || undefined,
        platform: i.platform.trim() || undefined,
        url: i.url.trim() || undefined,
        note: i.note.trim() || undefined,
      })),
    mediaIds: draft.mediaIds.length > 0 ? draft.mediaIds : undefined,
  };
  return item;
}
