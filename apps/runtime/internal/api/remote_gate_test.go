package api

import (
	"net/http"
	"testing"
)

// TestDisableRemoteGate: cloud mode turns off the remote read-only gate (its
// own layer owns access control), so a write from a non-loopback peer
// reaches the handler; without it the same write is refused.
func TestDisableRemoteGate(t *testing.T) {
	place := map[string]any{"name": "Bordeaux", "type": "city", "coordinates": map[string]float64{"lat": 44.8, "lng": -0.6}}

	gated, _ := newTestServer(t, true)
	wantStatus(t, do(t, gated.Handler(), "POST", "/api/places", place, fromNetwork), http.StatusForbidden)

	open, _ := newTestServer(t, true)
	open.DisableRemoteGate()
	wantStatus(t, do(t, open.Handler(), "POST", "/api/places", place, fromNetwork), http.StatusCreated)
}
