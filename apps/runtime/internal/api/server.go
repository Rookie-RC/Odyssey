// Package api exposes the local JSON API over HTTP. It is intentionally a
// thin, provider-neutral layer over the storage repository and geocoding
// manager; domain and presentation logic stays in the frontend.
package api

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/yuatlas/runtime/internal/domain"
	"github.com/yuatlas/runtime/internal/geocode"
	"github.com/yuatlas/runtime/internal/storage"
)

type Server struct {
	store    *storage.Repository
	geocoder *geocode.Manager
	dataDir  string
	provider string
	port     int
}

func NewServer(store *storage.Repository, geocoder *geocode.Manager, dataDir string, port int) *Server {
	return &Server{store: store, geocoder: geocoder, dataDir: dataDir, port: port, provider: geocoder.ProviderID()}
}

// Handler returns the API mux. CORS is applied by the caller in main.
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/runtime", s.handleRuntime)

	mux.HandleFunc("GET /api/profile", s.handleGetProfile)
	mux.HandleFunc("PUT /api/profile", s.handlePutProfile)

	mux.HandleFunc("GET /api/places", s.handleGetPlaces)
	mux.HandleFunc("POST /api/places", s.handleCreatePlace)
	mux.HandleFunc("PUT /api/places/{id}", s.handleUpdatePlace)
	mux.HandleFunc("DELETE /api/places/{id}", s.handleDeletePlace)

	mux.HandleFunc("GET /api/visits", s.handleGetVisits)
	mux.HandleFunc("POST /api/visits", s.handleCreateVisit)
	mux.HandleFunc("PUT /api/visits/{id}", s.handleUpdateVisit)
	mux.HandleFunc("DELETE /api/visits/{id}", s.handleDeleteVisit)

	mux.HandleFunc("GET /api/wishlist", s.handleGetWishlist)
	mux.HandleFunc("POST /api/wishlist", s.handleCreateWishlist)
	mux.HandleFunc("PUT /api/wishlist/{id}", s.handleUpdateWishlist)
	mux.HandleFunc("DELETE /api/wishlist/{id}", s.handleDeleteWishlist)

	mux.HandleFunc("GET /api/media", s.handleGetMedia)

	mux.HandleFunc("GET /api/settings", s.handleGetSettings)
	mux.HandleFunc("PUT /api/settings", s.handlePutSettings)

	mux.HandleFunc("GET /api/geocode/search", s.handleGeocodeSearch)
	mux.HandleFunc("GET /api/geocode/reverse", s.handleGeocodeReverse)
	return mux
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

func decodeBody(r *http.Request, v any) error {
	defer r.Body.Close()
	return json.NewDecoder(r.Body).Decode(v)
}

func (s *Server) handleRuntime(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"mode":              "local",
		"writable":          true,
		"port":              s.port,
		"dataDir":           s.dataDir,
		"geocodingProvider": s.provider,
	})
}

func (s *Server) handleGetProfile(w http.ResponseWriter, r *http.Request) {
	p, err := s.store.LoadProfile()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, p)
}

func (s *Server) handlePutProfile(w http.ResponseWriter, r *http.Request) {
	var p domain.Profile
	if err := decodeBody(r, &p); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if strings.TrimSpace(p.Name) == "" {
		writeError(w, http.StatusBadRequest, "name is required")
		return
	}
	if err := s.store.SaveProfile(p); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, p)
}

// --- Places ---

func (s *Server) handleGetPlaces(w http.ResponseWriter, r *http.Request) {
	places, err := s.store.LoadPlaces()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, places)
}

func (s *Server) handleCreatePlace(w http.ResponseWriter, r *http.Request) {
	var p domain.Place
	if err := decodeBody(r, &p); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if p.ID == "" {
		p.ID = newID()
	}
	if err := validatePlace(p); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	places, err := s.store.LoadPlaces()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	for _, ex := range places {
		if ex.ID == p.ID {
			writeError(w, http.StatusConflict, "place id already exists")
			return
		}
	}
	places = append(places, p)
	if err := s.store.SavePlaces(places); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, p)
}

func (s *Server) handleUpdatePlace(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var p domain.Place
	if err := decodeBody(r, &p); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if p.ID != "" && p.ID != id {
		writeError(w, http.StatusBadRequest, "id mismatch")
		return
	}
	p.ID = id
	if err := validatePlace(p); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	places, err := s.store.LoadPlaces()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	found := false
	for i := range places {
		if places[i].ID == id {
			places[i] = p
			found = true
			break
		}
	}
	if !found {
		writeError(w, http.StatusNotFound, "place not found")
		return
	}
	if err := s.store.SavePlaces(places); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, p)
}

func (s *Server) handleDeletePlace(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	places, err := s.store.LoadPlaces()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	idx := -1
	for i := range places {
		if places[i].ID == id {
			idx = i
			break
		}
	}
	if idx < 0 {
		writeError(w, http.StatusNotFound, "place not found")
		return
	}
	places = append(places[:idx], places[idx+1:]...)
	if err := s.store.SavePlaces(places); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"deleted": id})
}

func validatePlace(p domain.Place) error {
	if strings.TrimSpace(p.Name) == "" {
		return errors.New("name is required")
	}
	if !domain.ValidPlaceType(string(p.Type)) {
		return errors.New("type must be one of city, region, island, natural_area (countries are not Places)")
	}
	if p.Coordinates.Lat < -90 || p.Coordinates.Lat > 90 || p.Coordinates.Lng < -180 || p.Coordinates.Lng > 180 {
		return errors.New("coordinates out of range")
	}
	return nil
}

// --- Visits ---

func (s *Server) handleGetVisits(w http.ResponseWriter, r *http.Request) {
	visits, err := s.store.LoadVisits()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, visits)
}

func (s *Server) handleCreateVisit(w http.ResponseWriter, r *http.Request) {
	var v domain.Visit
	if err := decodeBody(r, &v); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if v.ID == "" {
		v.ID = newID()
	}
	if err := validateVisit(v); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if !s.placeExists(v.PlaceID) {
		writeError(w, http.StatusBadRequest, "placeId does not reference an existing place")
		return
	}
	visits, err := s.store.LoadVisits()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	for _, ex := range visits {
		if ex.ID == v.ID {
			writeError(w, http.StatusConflict, "visit id already exists")
			return
		}
	}
	visits = append(visits, v)
	if err := s.store.SaveVisits(visits); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, v)
}

func (s *Server) handleUpdateVisit(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var v domain.Visit
	if err := decodeBody(r, &v); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if v.ID != "" && v.ID != id {
		writeError(w, http.StatusBadRequest, "id mismatch")
		return
	}
	v.ID = id
	if err := validateVisit(v); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if !s.placeExists(v.PlaceID) {
		writeError(w, http.StatusBadRequest, "placeId does not reference an existing place")
		return
	}
	visits, err := s.store.LoadVisits()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	found := false
	for i := range visits {
		if visits[i].ID == id {
			visits[i] = v
			found = true
			break
		}
	}
	if !found {
		writeError(w, http.StatusNotFound, "visit not found")
		return
	}
	if err := s.store.SaveVisits(visits); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, v)
}

func (s *Server) handleDeleteVisit(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	visits, err := s.store.LoadVisits()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	idx := -1
	for i := range visits {
		if visits[i].ID == id {
			idx = i
			break
		}
	}
	if idx < 0 {
		writeError(w, http.StatusNotFound, "visit not found")
		return
	}
	visits = append(visits[:idx], visits[idx+1:]...)
	if err := s.store.SaveVisits(visits); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"deleted": id})
}

func validateVisit(v domain.Visit) error {
	if strings.TrimSpace(v.PlaceID) == "" {
		return errors.New("placeId is required")
	}
	if !domain.ValidVisitType(string(v.VisitType)) {
		return errors.New("invalid visitType")
	}
	return nil
}

// --- Wishlist ---

func (s *Server) handleGetWishlist(w http.ResponseWriter, r *http.Request) {
	items, err := s.store.LoadWishlist()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, items)
}

func (s *Server) handleCreateWishlist(w http.ResponseWriter, r *http.Request) {
	var item domain.Wishlist
	if err := decodeBody(r, &item); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if item.ID == "" {
		item.ID = newID()
	}
	if err := validateWishlist(item); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if !s.placeExists(item.PlaceID) {
		writeError(w, http.StatusBadRequest, "placeId does not reference an existing place")
		return
	}
	items, err := s.store.LoadWishlist()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	for _, ex := range items {
		if ex.ID == item.ID {
			writeError(w, http.StatusConflict, "wishlist id already exists")
			return
		}
	}
	items = append(items, item)
	if err := s.store.SaveWishlist(items); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, item)
}

func (s *Server) handleUpdateWishlist(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var item domain.Wishlist
	if err := decodeBody(r, &item); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if item.ID != "" && item.ID != id {
		writeError(w, http.StatusBadRequest, "id mismatch")
		return
	}
	item.ID = id
	if err := validateWishlist(item); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if !s.placeExists(item.PlaceID) {
		writeError(w, http.StatusBadRequest, "placeId does not reference an existing place")
		return
	}
	items, err := s.store.LoadWishlist()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	found := false
	for i := range items {
		if items[i].ID == id {
			items[i] = item
			found = true
			break
		}
	}
	if !found {
		writeError(w, http.StatusNotFound, "wishlist item not found")
		return
	}
	if err := s.store.SaveWishlist(items); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (s *Server) handleDeleteWishlist(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	items, err := s.store.LoadWishlist()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	idx := -1
	for i := range items {
		if items[i].ID == id {
			idx = i
			break
		}
	}
	if idx < 0 {
		writeError(w, http.StatusNotFound, "wishlist item not found")
		return
	}
	items = append(items[:idx], items[idx+1:]...)
	if err := s.store.SaveWishlist(items); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"deleted": id})
}

func validateWishlist(w domain.Wishlist) error {
	if strings.TrimSpace(w.PlaceID) == "" {
		return errors.New("placeId is required")
	}
	if w.Priority != 0 && (w.Priority < 1 || w.Priority > 5) {
		return errors.New("priority must be between 1 and 5")
	}
	return nil
}

// --- Media ---

func (s *Server) handleGetMedia(w http.ResponseWriter, r *http.Request) {
	media, err := s.store.LoadMedia()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, media)
}

// --- Settings ---

func (s *Server) handleGetSettings(w http.ResponseWriter, r *http.Request) {
	settings, err := s.store.LoadSettings()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, settings)
}

func (s *Server) handlePutSettings(w http.ResponseWriter, r *http.Request) {
	var settings domain.Settings
	if err := decodeBody(r, &settings); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if err := s.store.SaveSettings(settings); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, settings)
}

// --- Geocoding ---

func (s *Server) handleGeocodeSearch(w http.ResponseWriter, r *http.Request) {
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	if q == "" {
		writeError(w, http.StatusBadRequest, "q is required")
		return
	}
	if utf8.RuneCountInString(q) < 2 {
		writeError(w, http.StatusBadRequest, "q must be at least 2 characters")
		return
	}
	limit := 8
	if v := r.URL.Query().Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 && n <= 20 {
			limit = n
		}
	}
	results, err := s.geocoder.Search(r.Context(), q, geocode.SearchOptions{Limit: limit})
	if err != nil {
		writeError(w, http.StatusBadGateway, "geocoding provider error: "+err.Error())
		return
	}
	if results == nil {
		results = []geocode.Result{}
	}
	writeJSON(w, http.StatusOK, results)
}

func (s *Server) handleGeocodeReverse(w http.ResponseWriter, r *http.Request) {
	lat, err1 := strconv.ParseFloat(r.URL.Query().Get("lat"), 64)
	lng, err2 := strconv.ParseFloat(r.URL.Query().Get("lng"), 64)
	if err1 != nil || err2 != nil {
		writeError(w, http.StatusBadRequest, "lat and lng are required")
		return
	}
	res, err := s.geocoder.Reverse(r.Context(), lat, lng)
	if err != nil {
		writeError(w, http.StatusBadGateway, "geocoding provider error: "+err.Error())
		return
	}
	writeJSON(w, http.StatusOK, res)
}

func (s *Server) placeExists(placeID string) bool {
	places, err := s.store.LoadPlaces()
	if err != nil {
		return false
	}
	for _, p := range places {
		if p.ID == placeID {
			return true
		}
	}
	return false
}

func newID() string {
	var b [8]byte
	_, _ = rand.Read(b[:])
	return hex.EncodeToString(b[:])
}
