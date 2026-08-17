// Package storage implements the local JSON-backed repository. Atlas data is
// stored as JSON files under <dataDir>/data and written atomically (temp file
// then rename). It is the Go-side counterpart of the frontend repository
// abstraction and is deliberately independent of the HTTP layer.
package storage

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/yuatlas/runtime/internal/domain"
)

type Repository struct {
	mu   sync.RWMutex
	root string // atlas-data directory (contains data/ subdirectory)
}

func NewRepository(dataDir string) *Repository {
	return &Repository{root: dataDir}
}

func (r *Repository) dataDir() string { return filepath.Join(r.root, "data") }

// Ensure creates the data directory and any missing collection files so a
// fresh data directory is immediately usable.
func (r *Repository) Ensure() error {
	dir := r.dataDir()
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	empty := map[string]any{
		"profile.json":  domain.Profile{},
		"places.json":   []domain.Place{},
		"visits.json":   []domain.Visit{},
		"wishlist.json": []domain.Wishlist{},
		"media.json":    []domain.Media{},
		"settings.json": domain.Settings{},
	}
	for name, v := range empty {
		p := filepath.Join(dir, name)
		if _, err := os.Stat(p); os.IsNotExist(err) {
			if err := r.writeJSON(p, v); err != nil {
				return err
			}
		}
	}
	return nil
}

func readJSON(path string, out any) error {
	b, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	if len(b) == 0 {
		return nil
	}
	return json.Unmarshal(b, out)
}

func (r *Repository) writeJSON(path string, v any) error {
	b, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, b, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

func (r *Repository) loadSlice(name string, out any) error {
	r.mu.RLock()
	defer r.mu.RUnlock()
	path := filepath.Join(r.dataDir(), name)
	if _, err := os.Stat(path); os.IsNotExist(err) {
		return nil
	}
	return readJSON(path, out)
}

func (r *Repository) LoadProfile() (domain.Profile, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	var p domain.Profile
	if err := readJSON(filepath.Join(r.dataDir(), "profile.json"), &p); err != nil {
		return domain.Profile{}, err
	}
	return p, nil
}

func (r *Repository) SaveProfile(p domain.Profile) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.writeJSON(filepath.Join(r.dataDir(), "profile.json"), p)
}

func (r *Repository) LoadSettings() (domain.Settings, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	var s domain.Settings
	if err := readJSON(filepath.Join(r.dataDir(), "settings.json"), &s); err != nil {
		return domain.Settings{}, err
	}
	return s, nil
}

func (r *Repository) SaveSettings(s domain.Settings) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.writeJSON(filepath.Join(r.dataDir(), "settings.json"), s)
}

func (r *Repository) LoadPlaces() ([]domain.Place, error) {
	var out []domain.Place
	if err := r.loadSlice("places.json", &out); err != nil {
		return nil, err
	}
	return out, nil
}

func (r *Repository) SavePlaces(places []domain.Place) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.writeJSON(filepath.Join(r.dataDir(), "places.json"), places)
}

func (r *Repository) LoadVisits() ([]domain.Visit, error) {
	var out []domain.Visit
	if err := r.loadSlice("visits.json", &out); err != nil {
		return nil, err
	}
	return out, nil
}

func (r *Repository) SaveVisits(visits []domain.Visit) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.writeJSON(filepath.Join(r.dataDir(), "visits.json"), visits)
}

func (r *Repository) LoadWishlist() ([]domain.Wishlist, error) {
	var out []domain.Wishlist
	if err := r.loadSlice("wishlist.json", &out); err != nil {
		return nil, err
	}
	return out, nil
}

func (r *Repository) SaveWishlist(wishlist []domain.Wishlist) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.writeJSON(filepath.Join(r.dataDir(), "wishlist.json"), wishlist)
}

func (r *Repository) LoadMedia() ([]domain.Media, error) {
	var out []domain.Media
	if err := r.loadSlice("media.json", &out); err != nil {
		return nil, err
	}
	return out, nil
}

func (r *Repository) SaveMedia(media []domain.Media) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.writeJSON(filepath.Join(r.dataDir(), "media.json"), media)
}

// MediaDir returns the <dataDir>/media directory, creating it if needed.
// Media files live outside the JSON collections so they are served directly
// and survive JSON rewrites (PRODUCT_SPEC §10 storage layout).
func (r *Repository) MediaDir() (string, error) {
	dir := filepath.Join(r.root, "media")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	return dir, nil
}

// SaveMediaFile stores a media blob under media/<folder>/<filename> and returns
// the URL path used by Media records ("/media/<folder>/<filename>"). The folder
// and filename must already be sanitized by the caller.
func (r *Repository) SaveMediaFile(folder, filename string, data []byte) (string, error) {
	dir, err := r.MediaDir()
	if err != nil {
		return "", err
	}
	folder = filepath.Clean(folder)
	if folder == "." || folder == "" {
		folder = "misc"
	}
	sub := filepath.Join(dir, folder)
	if err := os.MkdirAll(sub, 0o755); err != nil {
		return "", err
	}
	rel := filepath.Join(folder, filename)
	if err := os.WriteFile(filepath.Join(dir, rel), data, 0o644); err != nil {
		return "", err
	}
	return "/media/" + filepath.ToSlash(rel), nil
}

// RemoveMediaFile deletes a stored media file. The path must be a relative
// media path ("folder/file"); missing files are treated as success so cleanup
// is idempotent.
func (r *Repository) RemoveMediaFile(relPath string) error {
	if relPath == "" {
		return nil
	}
	dir, err := r.MediaDir()
	if err != nil {
		return err
	}
	clean := filepath.Clean(filepath.FromSlash(relPath))
	if clean == "." || filepath.IsAbs(clean) || strings.Contains(clean, "..") {
		return nil // defensive: never remove outside the media root
	}
	err = os.Remove(filepath.Join(dir, clean))
	if err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}
