package api

import (
	"context"
	"net"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestIsRemote(t *testing.T) {
	tcp := func(ip string) net.Addr { return &net.TCPAddr{IP: net.ParseIP(ip), Port: 4317} }
	cases := []struct {
		name       string
		local      net.Addr // nil: no LocalAddrContextKey (synthetic request)
		remoteAddr string
		want       bool
	}{
		{"loopback v4", tcp("127.0.0.1"), "127.0.0.1:50000", false},
		{"loopback v6", tcp("::1"), "[::1]:50000", false},
		{"v4-mapped loopback peer", tcp("127.0.0.1"), "[::ffff:127.0.0.1]:50000", false},
		{"LAN listener, LAN peer", tcp("192.168.1.23"), "192.168.1.50:50000", true},
		// This computer opening its own LAN URL is a LAN viewer too.
		{"LAN listener, own LAN address", tcp("192.168.1.23"), "192.168.1.23:50000", true},
		{"LAN listener, loopback-looking peer", tcp("192.168.1.23"), "127.0.0.1:50000", true},
		{"wildcard bind, LAN peer", tcp("10.0.0.5"), "10.0.0.9:50000", true},
		{"no local addr, loopback peer", nil, "127.0.0.1:50000", false},
		{"no local addr, LAN peer", nil, "192.168.1.50:50000", true},
		{"unparseable peer", tcp("127.0.0.1"), "pipe", true},
		{"empty peer", nil, "", true},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			r := httptest.NewRequest("GET", "/", nil)
			r.RemoteAddr = c.remoteAddr
			if c.local != nil {
				r = r.WithContext(context.WithValue(r.Context(), http.LocalAddrContextKey, c.local))
			}
			if got := IsRemote(r); got != c.want {
				t.Errorf("IsRemote = %v, want %v", got, c.want)
			}
		})
	}
}

func TestAllowedHost(t *testing.T) {
	for host, want := range map[string]bool{
		"127.0.0.1:4317":     true,
		"127.0.0.1":          true,
		"localhost:4317":     true,
		"LOCALHOST:3000":     true,
		"[::1]:4317":         true,
		"[::1]":              true,
		"192.168.1.23:4317":  true, // LAN guests use the IP URL
		"10.0.0.5:4317":      true,
		"":                   true, // HTTP/1.0 without Host — never a browser
		"evil.example:4317":  false,
		"evil.example":       false,
		"localhost.evil.com": false,
		"127.0.0.1.nip.io":   false,
		"my-pc.local:4317":   false,
		"localhost.:4317":    false,
	} {
		if got := allowedHost(host); got != want {
			t.Errorf("allowedHost(%q) = %v, want %v", host, got, want)
		}
	}
}

func TestIsLoopbackOrigin(t *testing.T) {
	for origin, want := range map[string]bool{
		"http://127.0.0.1:4317":     true,
		"http://localhost:3000":     true,
		"https://localhost":         true,
		"http://[::1]:4317":         true,
		"http://127.0.0.2:8080":     true,
		"null":                      false,
		"http://192.168.1.23:4317":  false,
		"https://evil.example":      false,
		"http://localhost.evil.com": false,
		"file://":                   false,
	} {
		if got := isLoopbackOrigin(origin); got != want {
			t.Errorf("isLoopbackOrigin(%q) = %v, want %v", origin, got, want)
		}
	}
}

// protectedStack mirrors main's wiring: Protect around a mux with the API,
// a /media/ stand-in and a frontend stand-in.
func protectedStack(t *testing.T) http.Handler {
	t.Helper()
	s, _ := newTestServer(t, true)
	mux := http.NewServeMux()
	mux.Handle("/api/", s.Handler())
	ok := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusOK) })
	mux.Handle("/media/", ok)
	mux.Handle("/", ok)
	return Protect(mux)
}

// TestProtectDNSRebinding: a request whose Host is an unknown name is refused
// even over loopback — that is what a rebinding attack looks like.
func TestProtectDNSRebinding(t *testing.T) {
	h := protectedStack(t)
	for _, p := range []string{"/", "/api/places", "/media/bordeaux/bourse.jpg"} {
		w := do(t, h, "GET", p, nil, withHost("evil.example:4317"))
		wantStatus(t, w, http.StatusForbidden)
	}
	wantStatus(t, do(t, h, "POST", "/api/places", bordeaux, withHost("evil.example:4317")), http.StatusForbidden)

	// Legitimate local hosts.
	wantStatus(t, do(t, h, "GET", "/api/places", nil, withHost("localhost:4317")), http.StatusOK)
	wantStatus(t, do(t, h, "GET", "/api/places", nil, withHost("[::1]:4317")), http.StatusOK)
}

// TestProtectLAN: LAN GETs addressed to the LAN IP pass; everything else
// from the LAN is read-only — including the frontend and /media.
func TestProtectLAN(t *testing.T) {
	h := protectedStack(t)
	for _, p := range []string{"/", "/index.html", "/media/bordeaux/bourse.jpg", "/api/places", "/api/runtime"} {
		wantStatus(t, do(t, h, "GET", p, nil, fromLAN), http.StatusOK)
		wantStatus(t, do(t, h, "HEAD", p, nil, fromLAN), http.StatusOK)
	}
	for _, c := range []struct{ method, path string }{
		{"POST", "/"},
		{"PUT", "/media/bordeaux/bourse.jpg"},
		{"POST", "/api/places"},
		{"OPTIONS", "/api/places"},
		{"GET", "/api/geocode/search?q=Bordeaux"},
		{"GET", "/api/atlas/backups"},
		{"GET", "/api/atlas"},
	} {
		w := do(t, h, c.method, c.path, nil, fromLAN)
		if w.Code != http.StatusForbidden {
			t.Errorf("remote %s %s: status %d, want 403", c.method, c.path, w.Code)
			continue
		}
		if msg := errorOf(t, w); msg != remoteReadOnlyMsg {
			t.Errorf("remote %s %s: error %q", c.method, c.path, msg)
		}
	}
	// Remote clients never get CORS headers, even with a loopback Origin
	// (their "localhost" is a different machine).
	w := do(t, h, "GET", "/api/places", nil, fromLAN, withHeader("Origin", "http://localhost:3000"))
	if got := w.Header().Get("Access-Control-Allow-Origin"); got != "" {
		t.Errorf("remote got Access-Control-Allow-Origin %q", got)
	}
	// A rebinding name is refused for LAN clients as well.
	wantStatus(t, do(t, h, "GET", "/", nil, fromLAN, withHost("evil.example:4317")), http.StatusForbidden)
}

// TestProtectCSRFAndCORS: local writes carrying a foreign Origin are refused
// (CORS alone would let a "simple" cross-site POST execute); loopback origins
// (the app itself, the Next.js dev server) are allowed and get CORS headers.
func TestProtectCSRFAndCORS(t *testing.T) {
	h := protectedStack(t)

	for _, origin := range []string{"https://evil.example", "null", "http://192.168.1.23:3000"} {
		w := do(t, h, "POST", "/api/places", bordeaux, withHeader("Origin", origin), withHeader("Content-Type", "text/plain"))
		wantStatus(t, w, http.StatusForbidden)
		if got := w.Header().Get("Access-Control-Allow-Origin"); got != "" {
			t.Errorf("origin %q reflected", origin)
		}
	}
	// POST /api/atlas/new from a foreign page would wipe the Atlas.
	wantStatus(t, do(t, h, "POST", "/api/atlas/new", nil, withHeader("Origin", "https://evil.example")), http.StatusForbidden)

	// Cross-origin GETs are served (the browser hides the body without CORS
	// headers), but nothing is reflected.
	w := do(t, h, "GET", "/api/places", nil, withHeader("Origin", "https://evil.example"))
	wantStatus(t, w, http.StatusOK)
	if got := w.Header().Get("Access-Control-Allow-Origin"); got != "" {
		t.Errorf("foreign origin reflected on GET: %q", got)
	}

	// The dev server origin works and is reflected.
	w = do(t, h, "POST", "/api/places", bordeaux, withHeader("Origin", "http://localhost:3000"))
	wantStatus(t, w, http.StatusCreated)
	if got := w.Header().Get("Access-Control-Allow-Origin"); got != "http://localhost:3000" {
		t.Errorf("Access-Control-Allow-Origin = %q", got)
	}
	// Same-origin app and non-browser clients (no Origin) work.
	wantStatus(t, do(t, h, "POST", "/api/places", bordeaux, withHeader("Origin", "http://127.0.0.1:4317")), http.StatusCreated)
	wantStatus(t, do(t, h, "POST", "/api/places", bordeaux), http.StatusCreated)

	// Preflight.
	w = do(t, h, "OPTIONS", "/api/places", nil, withHeader("Origin", "http://localhost:3000"))
	wantStatus(t, w, http.StatusNoContent)
	if w.Header().Get("Access-Control-Allow-Methods") == "" {
		t.Error("preflight missing Allow-Methods")
	}
}
