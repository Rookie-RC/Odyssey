// Repository abstraction. The UI depends on AtlasRepository so the JSON-backed
// implementation (HttpAtlasRepository -> local runtime) can later be swapped
// for SupabaseRepository or RemoteApiRepository without UI changes.
import type { Media, Place, Profile, Visit, Wishlist } from "./types";
import { api } from "./api";

export interface AtlasRepository {
  getProfile(): Promise<Profile>;
  getPlaces(): Promise<Place[]>;
  getVisits(): Promise<Visit[]>;
  getWishlist(): Promise<Wishlist[]>;
  getMedia(): Promise<Media[]>;

  saveProfile(profile: Profile): Promise<void>;

  createPlace(place: Place): Promise<Place>;
  updatePlace(place: Place): Promise<Place>;
  deletePlace(id: string): Promise<void>;

  createVisit(visit: Visit): Promise<Visit>;
  updateVisit(visit: Visit): Promise<Visit>;
  deleteVisit(id: string): Promise<void>;

  createWishlist(item: Wishlist): Promise<Wishlist>;
  updateWishlist(item: Wishlist): Promise<Wishlist>;
  deleteWishlist(id: string): Promise<void>;

  uploadMedia(opts: {
    file: File;
    placeId?: string;
    caption?: string;
    sourceUrl?: string;
    author?: string;
    license?: string;
  }): Promise<Media>;
  updateMedia(media: Media): Promise<Media>;
  deleteMedia(id: string): Promise<void>;

  /** Downloads a portable .atlas package of the whole Atlas. */
  exportAtlas(): Promise<Blob>;
  /** Validates, backs up and replaces the current Atlas from a .atlas file. */
  importAtlas(file: File): Promise<{ imported: boolean; backup: string }>;
  /** Replaces the current Atlas with a blank one (backup created first). */
  newAtlas(): Promise<{ created: boolean; backup: string }>;
}

export class HttpAtlasRepository implements AtlasRepository {
  getProfile(): Promise<Profile> {
    return api.getProfile();
  }
  getPlaces(): Promise<Place[]> {
    return api.getPlaces();
  }
  getVisits(): Promise<Visit[]> {
    return api.getVisits();
  }
  getWishlist(): Promise<Wishlist[]> {
    return api.getWishlist();
  }
  getMedia(): Promise<Media[]> {
    return api.getMedia();
  }
  async saveProfile(profile: Profile): Promise<void> {
    await api.saveProfile(profile);
  }
  createPlace(place: Place): Promise<Place> {
    return api.createPlace(place);
  }
  updatePlace(place: Place): Promise<Place> {
    return api.updatePlace(place);
  }
  async deletePlace(id: string): Promise<void> {
    await api.deletePlace(id);
  }
  createVisit(visit: Visit): Promise<Visit> {
    return api.createVisit(visit);
  }
  updateVisit(visit: Visit): Promise<Visit> {
    return api.updateVisit(visit);
  }
  async deleteVisit(id: string): Promise<void> {
    await api.deleteVisit(id);
  }
  createWishlist(item: Wishlist): Promise<Wishlist> {
    return api.createWishlist(item);
  }
  updateWishlist(item: Wishlist): Promise<Wishlist> {
    return api.updateWishlist(item);
  }
  async deleteWishlist(id: string): Promise<void> {
    await api.deleteWishlist(id);
  }
  uploadMedia(opts: {
    file: File;
    placeId?: string;
    caption?: string;
    sourceUrl?: string;
    author?: string;
    license?: string;
  }): Promise<Media> {
    return api.uploadMedia(opts);
  }
  updateMedia(media: Media): Promise<Media> {
    return api.updateMedia(media);
  }
  async deleteMedia(id: string): Promise<void> {
    await api.deleteMedia(id);
  }
  exportAtlas(): Promise<Blob> {
    return api.exportAtlas();
  }
  importAtlas(file: File): Promise<{ imported: boolean; backup: string }> {
    return api.importAtlas(file);
  }
  newAtlas(): Promise<{ created: boolean; backup: string }> {
    return api.newAtlas();
  }
}
