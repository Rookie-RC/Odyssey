// Package geocode provides a provider-neutral geocoding abstraction plus an
// in-memory cache. The UI and domain model never depend on a specific vendor.
package geocode

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/yuatlas/runtime/internal/domain"
)

type SearchOptions struct {
	Limit int
}

// Result is the normalized, provider-neutral search result.
type Result struct {
	Name          string             `json:"name"`
	DisplayName   string             `json:"displayName"`
	Country       string             `json:"country,omitempty"`
	CountryCode   string             `json:"countryCode,omitempty"`
	SuggestedType domain.PlaceType   `json:"suggestedType,omitempty"`
	Coordinates   domain.Coordinates `json:"coordinates"`
	BBox          []float64          `json:"bbox,omitempty"`
	Provider      string             `json:"provider"`
	ProviderID    string             `json:"providerId,omitempty"`
}

type Provider interface {
	ID() string
	Search(ctx context.Context, query string, opts SearchOptions) ([]Result, error)
	Reverse(ctx context.Context, lat, lng float64) (*Result, error)
}

// Manager selects a provider and adds a small in-memory cache so repeated
// searches are not re-sent to the public service.
type Manager struct {
	provider Provider
	mu       sync.Mutex
	cache    map[string]cacheEntry
}

type cacheEntry struct {
	expires time.Time
	value   any
}

func NewManager(provider Provider) *Manager {
	return &Manager{provider: provider, cache: make(map[string]cacheEntry)}
}

func (m *Manager) ProviderID() string { return m.provider.ID() }

func (m *Manager) get(key string) (any, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	e, ok := m.cache[key]
	if !ok || time.Now().After(e.expires) {
		return nil, false
	}
	return e.value, true
}

func (m *Manager) set(key string, v any) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if len(m.cache) > 500 {
		for k := range m.cache {
			delete(m.cache, k)
			if len(m.cache) <= 400 {
				break
			}
		}
	}
	m.cache[key] = cacheEntry{expires: time.Now().Add(5 * time.Minute), value: v}
}

func (m *Manager) Search(ctx context.Context, query string, opts SearchOptions) ([]Result, error) {
	key := "s:" + query
	if v, ok := m.get(key); ok {
		if res, ok := v.([]Result); ok {
			return res, nil
		}
	}
	res, err := m.provider.Search(ctx, query, opts)
	if err != nil {
		return nil, err
	}
	m.set(key, res)
	return res, nil
}

func (m *Manager) Reverse(ctx context.Context, lat, lng float64) (*Result, error) {
	key := fmt.Sprintf("r:%.4f,%.4f", lat, lng)
	if v, ok := m.get(key); ok {
		if res, ok := v.(*Result); ok {
			return res, nil
		}
	}
	res, err := m.provider.Reverse(ctx, lat, lng)
	if err != nil {
		return nil, err
	}
	m.set(key, res)
	return res, nil
}
