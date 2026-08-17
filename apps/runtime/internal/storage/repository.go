// Package storage implements the local JSON-backed repository. Atlas data is
// stored as JSON files under <dataDir>/data and written atomically (temp file
// then rename). It is the Go-side counterpart of the frontend repository
// abstraction and is deliberately independent of the HTTP layer.
package storage

import (
	"encoding/json"
	"os"
	"path/filepath"
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
