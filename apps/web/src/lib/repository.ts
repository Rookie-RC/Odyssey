// Repository abstraction. The UI depends on AtlasRepository so the JSON-backed
// implementation (HttpAtlasRepository -> local runtime) can later be swapped
// for SupabaseRepository or RemoteApiRepository without UI changes.
import type { Place, Profile, Visit, Wishlist, Media } from "./types";
import { api } from "./api";

export interface AtlasRepository {
  getProfile(): Promise<Profile>;
  getPlaces(): Promise<Place[]>;
  getVisits(): Promise<Visit[]>;
  getWishlist(): Promise<Wishlist[]>;
  getMedia(): Promise<Media[]>;

  saveProfile(profile: Profile): Promise<void>;

  createPlace(place: Place): Promise<void>;
  updatePlace(place: Place): Promise<void>;

  createVisit(visit: Visit): Promise<void>;
  updateVisit(visit: Visit): Promise<void>;

  createWishlist(item: Wishlist): Promise<void>;
  updateWishlist(item: Wishlist): Promise<void>;
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
  async createPlace(place: Place): Promise<void> {
    await api.createPlace(place);
  }
  async updatePlace(place: Place): Promise<void> {
    await api.updatePlace(place);
  }
  async createVisit(visit: Visit): Promise<void> {
    await api.createVisit(visit);
  }
  async updateVisit(visit: Visit): Promise<void> {
    await api.updateVisit(visit);
  }
  async createWishlist(item: Wishlist): Promise<void> {
    await api.createWishlist(item);
  }
  async updateWishlist(item: Wishlist): Promise<void> {
    await api.updateWishlist(item);
  }
}
