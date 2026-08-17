// Shared draft shapes for Manage Atlas add/edit forms. Drafts are UI-shaped
// (strings for number/date-ish fields) and are converted to domain records at
// save time in the flow components.
import type { InspirationType, Season, VisitType } from "../../lib/types";

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
