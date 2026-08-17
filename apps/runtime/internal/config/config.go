// Package config loads machine-specific runtime configuration (geocoder
// provider choice and credentials). These values are intentionally kept out of
// the portable Atlas data and out of .yuatlas exports.
package config

import (
	"encoding/json"
	"os"
	"path/filepath"
)

type Config struct {
	GeocodingProvider string `json:"geocodingProvider"`
	MapTilerAPIKey    string `json:"mapTilerApiKey"`
}

// Load reads runtime-config.json from the data root (atlas-data/). Missing or
// malformed config falls back to safe defaults (Photon, no key).
func Load(root string) Config {
	cfg := Config{GeocodingProvider: "photon"}
	b, err := os.ReadFile(filepath.Join(root, "runtime-config.json"))
	if err != nil {
		return cfg
	}
	_ = json.Unmarshal(b, &cfg)
	if cfg.GeocodingProvider == "" {
		cfg.GeocodingProvider = "photon"
	}
	return cfg
}
