package api

import (
	"net/http"
	"testing"
)

// TestDisableLANGate: cloud mode turns off the LAN read-only gate (its own
// layer owns access control), so a write from a non-loopback peer reaches
// the handler; without it the same write is refused.
func TestDisableLANGate(t *testing.T) {
	place := map[string]any{"name": "Bordeaux", "type": "city", "coordinates": map[string]float64{"lat": 44.8, "lng": -0.6}}

	gated, _ := newTestServer(t, true)
	wantStatus(t, do(t, gated.Handler(), "POST", "/api/places", place, fromLAN), http.StatusForbidden)

	open, _ := newTestServer(t, true)
	open.DisableLANGate()
	wantStatus(t, do(t, open.Handler(), "POST", "/api/places", place, fromLAN), http.StatusCreated)
}
