// Package api exposes the local JSON API over HTTP. It is intentionally a
// thin, provider-neutral layer over the storage repository and geocoding
// manager; domain and presentation logic stays in the frontend.
package api

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/yuatlas/runtime/internal/atlas"
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

	// writable reports whether this runtime allows edits (PRODUCT_SPEC §26:
	// editing functionality is only exposed in writable local mode). The
	// frontend hides all editing UI when the runtime reports read-only, and
	// mutating API requests are rejected outright below.
	writable bool

	// writeMu serializes every mutating request (CRUD create/update/delete,
	// media upload, profile/settings save, and atlas export/import/new).
	// Each CRUD handler is a load-mutate-save sequence over the same JSON
	// files with no atomicity of its own: two concurrent writes (a
	// double-submit, two browser tabs) would otherwise both load the same
	// base slice, and the second Save silently discards the first write.
	// Serializing at the handler level is the simplest correct fix for a
	// local, low-concurrency, single-user server. It also keeps CRUD writes
	// from interleaving with atlas import/new, which used to be guarded by a
	// separate mutex and so could still race with unrelated CRUD requests.
	writeMu sync.Mutex
}

func NewServer(store *storage.Repository, geocoder *geocode.Manager, dataDir string, port int, writable bool) *Server {
	return &Server{store: store, geocoder: geocoder, dataDir: dataDir, port: port, provider: geocoder.ProviderID(), writable: writable}
}

// Handler returns the API mux. CORS is applied by the caller in main. In
// read-only mode all mutating requests (POST/PUT/DELETE) are rejected before
// they reach a handler, so a read-only runtime can never change data even if
// the frontend is tricked into sending a write.
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
	mux.HandleFunc("POST /api/media", s.handleUploadMedia)
	mux.HandleFunc("PUT /api/media/{id}", s.handleUpdateMedia)
	mux.HandleFunc("DELETE /api/media/{id}", s.handleDeleteMedia)

	mux.HandleFunc("GET /api/settings", s.handleGetSettings)
	mux.HandleFunc("PUT /api/settings", s.handlePutSettings)

	mux.HandleFunc("GET /api/geocode/search", s.handleGeocodeSearch)
	mux.HandleFunc("GET /api/geocode/reverse", s.handleGeocodeReverse)

	mux.HandleFunc("POST /api/atlas/export", s.handleExportAtlas)
	mux.HandleFunc("POST /api/atlas/import", s.handleImportAtlas)
	mux.HandleFunc("POST /api/atlas/new", s.handleNewAtlas)

	if !s.writable {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Method != http.MethodGet && r.Method != http.MethodHead && r.Method != http.MethodOptions {
				writeError(w, http.StatusForbidden, "runtime is read-only")
				return
			}
			mux.ServeHTTP(w, r)
		})
	}
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
		"writable":          s.writable,
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
	s.writeMu.Lock()
	defer s.writeMu.Unlock()
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
	s.writeMu.Lock()
	defer s.writeMu.Unlock()
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
	s.writeMu.Lock()
	defer s.writeMu.Unlock()
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
	s.writeMu.Lock()
	defer s.writeMu.Unlock()
	id := r.PathValue("id")
	visits, err := s.store.LoadVisits()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	wishlist, err := s.store.LoadWishlist()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	visitRefs := 0
	for _, v := range visits {
		if v.PlaceID == id {
			visitRefs++
		}
	}
	wishlistRefs := 0
	for _, w := range wishlist {
		if w.PlaceID == id {
			wishlistRefs++
		}
	}
	if visitRefs > 0 || wishlistRefs > 0 {
		writeError(w, http.StatusConflict,
			"place is still referenced by "+strconv.Itoa(visitRefs)+" visit(s) and "+strconv.Itoa(wishlistRefs)+" wishlist item(s); remove those entries first")
		return
	}
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
	s.writeMu.Lock()
	defer s.writeMu.Unlock()
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
	s.writeMu.Lock()
	defer s.writeMu.Unlock()
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
	s.writeMu.Lock()
	defer s.writeMu.Unlock()
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
	s.writeMu.Lock()
	defer s.writeMu.Unlock()
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
	s.writeMu.Lock()
	defer s.writeMu.Unlock()
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
	s.writeMu.Lock()
	defer s.writeMu.Unlock()
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

// handleUploadMedia stores an uploaded image under atlas-data/media and appends
// a Media record to media.json. The optional placeId chooses the storage folder
// (organized by Place, PRODUCT_SPEC §10); without it a "misc" folder is used.
func (s *Server) handleUploadMedia(w http.ResponseWriter, r *http.Request) {
	s.writeMu.Lock()
	defer s.writeMu.Unlock()
	if err := r.ParseMultipartForm(25 << 20); err != nil {
		writeError(w, http.StatusBadRequest, "upload too large or invalid multipart body")
		return
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		writeError(w, http.StatusBadRequest, "file field is required")
		return
	}
	defer file.Close()

	if !supportedImageType(header.Header.Get("Content-Type")) && !supportedImageExt(header.Filename) {
		writeError(w, http.StatusBadRequest, "unsupported file type; expected an image (jpg, png, gif, webp, avif)")
		return
	}
	data, err := io.ReadAll(io.LimitReader(file, 25<<20))
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if len(data) == 0 {
		writeError(w, http.StatusBadRequest, "empty file")
		return
	}

	// Storage folder follows the Place when one is referenced.
	folder := "misc"
	if placeID := strings.TrimSpace(r.FormValue("placeId")); placeID != "" {
		if places, err := s.store.LoadPlaces(); err == nil {
			for _, p := range places {
				if p.ID == placeID {
					if slug := slugify(p.Name); slug != "" {
						folder = slug
					}
					break
				}
			}
		}
	}
	filename := sanitizeFilename(header.Filename)

	// Avoid filename collisions (never silently overwrite an existing file).
	if s.mediaFileExists(folder, filename) {
		filename = addRandomSuffix(filename)
	}
	relPath, err := s.store.SaveMediaFile(folder, filename, data)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	m := domain.Media{
		ID:        newID(),
		Type:      "image",
		Source:    domain.MediaSourceLocal,
		Path:      relPath,
		Caption:   strings.TrimSpace(r.FormValue("caption")),
		SourceURL: strings.TrimSpace(r.FormValue("sourceUrl")),
		Author:    strings.TrimSpace(r.FormValue("author")),
		License:   strings.TrimSpace(r.FormValue("license")),
	}
	if m.SourceURL != "" {
		m.Source = domain.MediaSourceWeb
	}
	media, err := s.store.LoadMedia()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	media = append(media, m)
	if err := s.store.SaveMedia(media); err != nil {
		_ = s.store.RemoveMediaFile(relPath)
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, m)
}

func (s *Server) handleUpdateMedia(w http.ResponseWriter, r *http.Request) {
	s.writeMu.Lock()
	defer s.writeMu.Unlock()
	id := r.PathValue("id")
	var m domain.Media
	if err := decodeBody(r, &m); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if m.ID != "" && m.ID != id {
		writeError(w, http.StatusBadRequest, "id mismatch")
		return
	}
	m.ID = id
	if m.Type == "" {
		m.Type = "image"
	}
	if m.Type != "image" {
		writeError(w, http.StatusBadRequest, "type must be image")
		return
	}
	media, err := s.store.LoadMedia()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	found := false
	for i := range media {
		if media[i].ID == id {
			media[i] = m
			found = true
			break
		}
	}
	if !found {
		writeError(w, http.StatusNotFound, "media not found")
		return
	}
	if err := s.store.SaveMedia(media); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, m)
}

// handleDeleteMedia removes a Media record and its file. Records still
// referenced by a Visit or Wishlist are rejected so shared media is never
// silently removed (the reference lists are the authoritative association).
func (s *Server) handleDeleteMedia(w http.ResponseWriter, r *http.Request) {
	s.writeMu.Lock()
	defer s.writeMu.Unlock()
	id := r.PathValue("id")
	media, err := s.store.LoadMedia()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	var target *domain.Media
	for i := range media {
		if media[i].ID == id {
			target = &media[i]
			break
		}
	}
	if target == nil {
		writeError(w, http.StatusNotFound, "media not found")
		return
	}
	visits, err := s.store.LoadVisits()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	wishlist, err := s.store.LoadWishlist()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	refs := 0
	for _, v := range visits {
		if containsString(v.MediaIDs, id) {
			refs++
		}
	}
	for _, w := range wishlist {
		if containsString(w.MediaIDs, id) {
			refs++
		}
	}
	if refs > 0 {
		writeError(w, http.StatusConflict, "media is still referenced by "+strconv.Itoa(refs)+" visit(s)/wishlist item(s); remove the references first")
		return
	}
	for i := range media {
		if media[i].ID == id {
			media = append(media[:i], media[i+1:]...)
			break
		}
	}
	if err := s.store.SaveMedia(media); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	_ = s.store.RemoveMediaFile(strings.TrimPrefix(target.Path, "/media/"))
	writeJSON(w, http.StatusOK, map[string]string{"deleted": id})
}

func (s *Server) mediaAbsPath(relPath string) string {
	dir, err := s.store.MediaDir()
	if err != nil {
		return ""
	}
	return filepath.Join(dir, filepath.FromSlash(strings.TrimPrefix(relPath, "/media/")))
}

// mediaFileExists reports whether a media file already exists under
// media/<folder>/<filename>.
func (s *Server) mediaFileExists(folder, filename string) bool {
	path := s.mediaAbsPath("/media/" + folder + "/" + filename)
	if path == "" {
		return false
	}
	_, err := os.Stat(path)
	return err == nil
}

func containsString(list []string, v string) bool {
	for _, s := range list {
		if s == v {
			return true
		}
	}
	return false
}

func supportedImageType(mime string) bool {
	switch strings.ToLower(strings.TrimSpace(strings.SplitN(mime, ";", 2)[0])) {
	case "image/jpeg", "image/png", "image/gif", "image/webp", "image/avif":
		return true
	}
	return false
}

func supportedImageExt(name string) bool {
	ext := strings.ToLower(filepath.Ext(name))
	switch ext {
	case ".jpg", ".jpeg", ".png", ".gif", ".webp", ".avif":
		return true
	}
	return false
}

func sanitizeFilename(name string) string {
	name = filepath.Base(name)
	var b strings.Builder
	for _, r := range name {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9',
			r == '.', r == '-', r == '_':
			b.WriteRune(r)
		default:
			b.WriteRune('-')
		}
	}
	out := strings.Trim(b.String(), ".-")
	if out == "" {
		out = "image"
	}
	if len(out) > 80 {
		out = out[len(out)-80:]
	}
	return out
}

func addRandomSuffix(name string) string {
	ext := filepath.Ext(name)
	base := strings.TrimSuffix(name, ext)
	return base + "-" + newID()[:6] + ext
}

func slugify(s string) string {
	var b strings.Builder
	for _, r := range strings.ToLower(s) {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9':
			b.WriteRune(r)
		case r == ' ' || r == '-' || r == '/' || r == '\\' || r == '_':
			b.WriteRune('-')
		}
	}
	out := strings.Trim(b.String(), "-")
	if out == "" {
		return ""
	}
	// collapse repeated separators
	prev := rune(0)
	var c strings.Builder
	for _, r := range out {
		if r == '-' && prev == '-' {
			continue
		}
		c.WriteRune(r)
		prev = r
	}
	return c.String()
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
	s.writeMu.Lock()
	defer s.writeMu.Unlock()
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

func (s *Server) placeExists(placeID string) bool {	places, err := s.store.LoadPlaces()
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

// --- Atlas portability (export / import / new) ---
// The runtime owns packaging, validation, backup and replacement; the browser
// only invokes these endpoints and presents progress/results (PRODUCT_SPEC
// §30–33). A single mutex serializes these operations so a destructive
// replacement never races another packaging operation.

func (s *Server) handleExportAtlas(w http.ResponseWriter, r *http.Request) {
	s.writeMu.Lock()
	defer s.writeMu.Unlock()

	name := "yu-atlas-" + time.Now().Format("20060102-150405") + ".atlas"
	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", `attachment; filename="`+name+`"`)
	if err := atlas.Export(s.dataDir, w); err != nil {
		// Headers are already committed when streaming; report the failure via
		// the runtime log (the client sees a truncated download).
		s.reportError("export failed", err)
	}
}

func (s *Server) handleImportAtlas(w http.ResponseWriter, r *http.Request) {
	s.writeMu.Lock()
	defer s.writeMu.Unlock()

	if err := r.ParseMultipartForm(512 << 20); err != nil {
		writeError(w, http.StatusBadRequest, "upload too large or invalid multipart body")
		return
	}
	file, _, err := r.FormFile("file")
	if err != nil {
		writeError(w, http.StatusBadRequest, "file field is required")
		return
	}
	defer file.Close()

	// The package must be readable as a random-access archive (zip.NewReader),
	// so spool it to a temp file instead of holding it in memory.
	tmp, err := os.CreateTemp("", "atlas-import-*.atlas")
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	tmpName := tmp.Name()
	defer os.Remove(tmpName)
	size, err := io.Copy(tmp, file)
	tmp.Close()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if size == 0 {
		writeError(w, http.StatusBadRequest, "empty package")
		return
	}

	rf, err := os.Open(tmpName)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer rf.Close()

	st, err := atlas.ValidateAndStage(s.dataDir, size, rf)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	backupRel, err := st.Replace()
	if err != nil {
		// Replace() always creates the backup before attempting the swap (and
		// rolls the swap back on failure, so the live Atlas is left
		// untouched) — surface the backup name even on failure so the user
		// has it for reference.
		writeJSON(w, http.StatusInternalServerError, map[string]any{
			"error":  err.Error(),
			"backup": backupRel,
		})
		return
	}
	st.Cleanup()

	writeJSON(w, http.StatusOK, map[string]any{
		"imported": true,
		"backup":   backupRel,
		"schemaVersion": st.Manifest.SchemaVersion,
	})
}

func (s *Server) handleNewAtlas(w http.ResponseWriter, r *http.Request) {
	s.writeMu.Lock()
	defer s.writeMu.Unlock()

	keepTheme := ""
	if settings, err := s.store.LoadSettings(); err == nil {
		keepTheme = settings.Theme
	}
	backupRel, err := atlas.NewAtlas(s.dataDir, keepTheme)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"created": true, "backup": backupRel})
}

// reportError logs a server-side failure (used where headers are already
// committed while streaming).
func (s *Server) reportError(op string, err error) {
	if err != nil {
		log.Printf("%s: %v", op, err)
	}
}
