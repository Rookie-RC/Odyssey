package api

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"testing"

	"github.com/yuatlas/runtime/internal/atlas"
	"github.com/yuatlas/runtime/internal/domain"
	"github.com/yuatlas/runtime/internal/geocode"
	"github.com/yuatlas/runtime/internal/lan"
	"github.com/yuatlas/runtime/internal/storage"
)

// --- test helpers ---

// stubGeocoder keeps tests offline.
type stubGeocoder struct{}

func (stubGeocoder) ID() string { return "stub" }
func (stubGeocoder) Search(context.Context, string, geocode.SearchOptions) ([]geocode.Result, error) {
	return []geocode.Result{{Name: "Bordeaux", Provider: "stub"}}, nil
}
func (stubGeocoder) Reverse(context.Context, float64, float64) (*geocode.Result, error) {
	return &geocode.Result{Name: "Bordeaux", Provider: "stub"}, nil
}

// fakeLAN records SetEnabled calls.
type fakeLAN struct {
	mu    sync.Mutex
	calls []bool
	state lan.Status
}

func (f *fakeLAN) SetEnabled(on bool) lan.Status {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.calls = append(f.calls, on)
	f.state.Enabled = on
	f.state.URLs = []string{}
	if on {
		f.state.URLs = []string{"http://192.168.1.23:4317"}
	}
	return f.state
}

func (f *fakeLAN) Status() lan.Status {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.state
}

func newTestServer(t *testing.T, writable bool) (*Server, string) {
	t.Helper()
	dir := t.TempDir()
	repo := storage.NewRepository(dir)
	if err := repo.Ensure(); err != nil {
		t.Fatal(err)
	}
	return NewServer(repo, geocode.NewManager(stubGeocoder{}), dir, 4317, writable), dir
}

// reqOption adjusts a test request (who sends it, extra headers).
type reqOption func(*http.Request) *http.Request

// fromLoopback simulates the owner's browser: a connection accepted on
// 127.0.0.1:4317 from a loopback peer.
func fromLoopback(r *http.Request) *http.Request {
	r.RemoteAddr = "127.0.0.1:52000"
	r.Host = "127.0.0.1:4317"
	return r.WithContext(context.WithValue(r.Context(), http.LocalAddrContextKey,
		&net.TCPAddr{IP: net.IPv4(127, 0, 0, 1), Port: 4317}))
}

// fromLAN simulates a phone on the Wi-Fi: accepted on the LAN listener
// 192.168.1.23:4317, peer 192.168.1.50.
func fromLAN(r *http.Request) *http.Request {
	r.RemoteAddr = "192.168.1.50:52000"
	r.Host = "192.168.1.23:4317"
	return r.WithContext(context.WithValue(r.Context(), http.LocalAddrContextKey,
		&net.TCPAddr{IP: net.IPv4(192, 168, 1, 23), Port: 4317}))
}

func withHeader(k, v string) reqOption {
	return func(r *http.Request) *http.Request { r.Header.Set(k, v); return r }
}

func withHost(h string) reqOption {
	return func(r *http.Request) *http.Request { r.Host = h; return r }
}

// do sends a request (from loopback unless an option says otherwise) and
// returns the recorder. body may be nil, a string, or a value to JSON-encode.
func do(t *testing.T, h http.Handler, method, target string, body any, opts ...reqOption) *httptest.ResponseRecorder {
	t.Helper()
	var rd io.Reader
	switch b := body.(type) {
	case nil:
	case string:
		rd = strings.NewReader(b)
	default:
		buf, err := json.Marshal(b)
		if err != nil {
			t.Fatal(err)
		}
		rd = bytes.NewReader(buf)
	}
	r := fromLoopback(httptest.NewRequest(method, target, rd))
	for _, o := range opts {
		r = o(r)
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w
}

func decode[T any](t *testing.T, w *httptest.ResponseRecorder) T {
	t.Helper()
	var v T
	if err := json.Unmarshal(w.Body.Bytes(), &v); err != nil {
		t.Fatalf("decode %q: %v", w.Body.String(), err)
	}
	return v
}

func wantStatus(t *testing.T, w *httptest.ResponseRecorder, status int) {
	t.Helper()
	if w.Code != status {
		t.Fatalf("status = %d, want %d; body: %s", w.Code, status, w.Body.String())
	}
}

func errorOf(t *testing.T, w *httptest.ResponseRecorder) string {
	t.Helper()
	return decode[map[string]any](t, w)["error"].(string)
}

var bordeaux = domain.Place{
	Name: "Bordeaux", Country: "France", CountryCode: "FR", Type: domain.PlaceTypeCity,
	Coordinates: domain.Coordinates{Lat: 44.84, Lng: -0.58},
}

// --- CRUD ---

func TestPlacesCRUD(t *testing.T) {
	s, _ := newTestServer(t, true)
	h := s.Handler()

	w := do(t, h, "POST", "/api/places", bordeaux)
	wantStatus(t, w, http.StatusCreated)
	created := decode[domain.Place](t, w)
	if created.ID == "" || created.Name != "Bordeaux" {
		t.Fatalf("created = %+v", created)
	}

	// Validation: countries are not places, coordinates must be sane.
	bad := bordeaux
	bad.Type = "country"
	wantStatus(t, do(t, h, "POST", "/api/places", bad), http.StatusBadRequest)
	bad = bordeaux
	bad.Coordinates.Lat = 120
	wantStatus(t, do(t, h, "POST", "/api/places", bad), http.StatusBadRequest)
	wantStatus(t, do(t, h, "POST", "/api/places", "{not json"), http.StatusBadRequest)
	dup := bordeaux
	dup.ID = created.ID
	wantStatus(t, do(t, h, "POST", "/api/places", dup), http.StatusConflict)

	upd := created
	upd.Name = "Bordeaux (Chartrons)"
	w = do(t, h, "PUT", "/api/places/"+created.ID, upd)
	wantStatus(t, w, http.StatusOK)
	wantStatus(t, do(t, h, "PUT", "/api/places/nope", bordeaux), http.StatusNotFound)
	mismatch := created
	mismatch.ID = "other"
	wantStatus(t, do(t, h, "PUT", "/api/places/"+created.ID, mismatch), http.StatusBadRequest)

	w = do(t, h, "GET", "/api/places", nil)
	wantStatus(t, w, http.StatusOK)
	list := decode[[]domain.Place](t, w)
	if len(list) != 1 || list[0].Name != "Bordeaux (Chartrons)" {
		t.Fatalf("list = %+v", list)
	}

	wantStatus(t, do(t, h, "DELETE", "/api/places/"+created.ID, nil), http.StatusOK)
	wantStatus(t, do(t, h, "DELETE", "/api/places/"+created.ID, nil), http.StatusNotFound)
	if list := decode[[]domain.Place](t, do(t, h, "GET", "/api/places", nil)); len(list) != 0 {
		t.Fatalf("after delete: %+v", list)
	}
}

func TestVisitsCRUD(t *testing.T) {
	s, _ := newTestServer(t, true)
	h := s.Handler()
	place := decode[domain.Place](t, do(t, h, "POST", "/api/places", bordeaux))

	// The referenced place must exist and the visit type must be known.
	wantStatus(t, do(t, h, "POST", "/api/visits", domain.Visit{PlaceID: "ghost", VisitType: domain.VisitTypeTrip}), http.StatusBadRequest)
	wantStatus(t, do(t, h, "POST", "/api/visits", domain.Visit{PlaceID: place.ID, VisitType: "cruise"}), http.StatusBadRequest)
	wantStatus(t, do(t, h, "POST", "/api/visits", domain.Visit{PlaceID: place.ID, VisitType: domain.VisitTypeTrip, Transport: "zeppelin"}), http.StatusBadRequest)
	// Activities: short lowercase slugs, distinct, at most eight.
	for _, bad := range [][]string{
		{"ski", "ski"},
		{"Ski"},
		{""},
		{"<script>"},
		{"a", "b", "c", "d", "e", "f", "g", "h", "i"},
	} {
		w := do(t, h, "POST", "/api/visits", domain.Visit{PlaceID: place.ID, VisitType: domain.VisitTypeTrip, Activities: bad})
		wantStatus(t, w, http.StatusBadRequest)
	}

	w := do(t, h, "POST", "/api/visits", domain.Visit{PlaceID: place.ID, VisitType: domain.VisitTypeLived, StartDate: "2023-09"})
	wantStatus(t, w, http.StatusCreated)
	v := decode[domain.Visit](t, w)

	v.Reflection = "golden stone"
	v.Transport = domain.TransportTrain
	// Unknown-but-well-formed ids are kept: the vocabulary lives in the frontend.
	v.Activities = []string{"citywalk", "food", "wine_tasting"}
	wantStatus(t, do(t, h, "PUT", "/api/visits/"+v.ID, v), http.StatusOK)
	list := decode[[]domain.Visit](t, do(t, h, "GET", "/api/visits", nil))
	if len(list) != 1 || list[0].Reflection != "golden stone" || list[0].Transport != domain.TransportTrain ||
		!reflect.DeepEqual(list[0].Activities, []string{"citywalk", "food", "wine_tasting"}) {
		t.Fatalf("list = %+v", list)
	}

	// A referenced place cannot be deleted.
	wantStatus(t, do(t, h, "DELETE", "/api/places/"+place.ID, nil), http.StatusConflict)

	wantStatus(t, do(t, h, "DELETE", "/api/visits/"+v.ID, nil), http.StatusOK)
	wantStatus(t, do(t, h, "DELETE", "/api/visits/"+v.ID, nil), http.StatusNotFound)
	wantStatus(t, do(t, h, "DELETE", "/api/places/"+place.ID, nil), http.StatusOK)
}

func TestWishlistCRUD(t *testing.T) {
	s, _ := newTestServer(t, true)
	h := s.Handler()
	place := decode[domain.Place](t, do(t, h, "POST", "/api/places", bordeaux))

	wantStatus(t, do(t, h, "POST", "/api/wishlist", domain.Wishlist{PlaceID: place.ID, Priority: 9}), http.StatusBadRequest)
	wantStatus(t, do(t, h, "POST", "/api/wishlist", domain.Wishlist{PlaceID: "ghost"}), http.StatusBadRequest)

	w := do(t, h, "POST", "/api/wishlist", domain.Wishlist{PlaceID: place.ID, Priority: 4, Seasons: []domain.Season{domain.SeasonAutumn}})
	wantStatus(t, w, http.StatusCreated)
	item := decode[domain.Wishlist](t, w)

	item.Why = "the light in October"
	wantStatus(t, do(t, h, "PUT", "/api/wishlist/"+item.ID, item), http.StatusOK)
	wantStatus(t, do(t, h, "PUT", "/api/wishlist/nope", item), http.StatusBadRequest) // id mismatch
	list := decode[[]domain.Wishlist](t, do(t, h, "GET", "/api/wishlist", nil))
	if len(list) != 1 || list[0].Why != "the light in October" {
		t.Fatalf("list = %+v", list)
	}

	wantStatus(t, do(t, h, "DELETE", "/api/wishlist/"+item.ID, nil), http.StatusOK)
	if list := decode[[]domain.Wishlist](t, do(t, h, "GET", "/api/wishlist", nil)); len(list) != 0 {
		t.Fatalf("after delete: %+v", list)
	}
}

// TestSettingsRoundTrip: free-form theme ids and the map display toggles are
// stored verbatim — including an explicit "wishlist off", which must not
// collapse into "unset" (that means shown).
func TestSettingsRoundTrip(t *testing.T) {
	s, _ := newTestServer(t, true)
	h := s.Handler()
	off := false
	in := domain.Settings{Theme: "film", ShowWishlist: &off, HideCountries: true, ShowRoutes: true}
	wantStatus(t, do(t, h, "PUT", "/api/settings", in), http.StatusOK)
	got := decode[domain.Settings](t, do(t, h, "GET", "/api/settings", nil))
	if !reflect.DeepEqual(got, in) {
		t.Errorf("settings = %+v, want %+v", got, in)
	}
	if got.ShowWishlist == nil || *got.ShowWishlist {
		t.Errorf("explicit showWishlist=false was not kept: %+v", got.ShowWishlist)
	}
}

// --- read-only mode ---

func TestReadonlyRejectsWrites(t *testing.T) {
	s, _ := newTestServer(t, false)
	h := s.Handler()

	for _, c := range []struct{ method, path string }{
		{"POST", "/api/places"},
		{"PUT", "/api/places/p1"},
		{"DELETE", "/api/places/p1"},
		{"PUT", "/api/settings"},
		{"POST", "/api/atlas/new"},
		{"POST", "/api/atlas/backups/backup-20260101-000000.atlas/restore"},
		{"DELETE", "/api/atlas/backups/backup-20260101-000000.atlas"},
	} {
		w := do(t, h, c.method, c.path, bordeaux)
		wantStatus(t, w, http.StatusForbidden)
		if msg := errorOf(t, w); msg != "runtime is read-only" {
			t.Errorf("%s %s: error = %q", c.method, c.path, msg)
		}
	}
	// Backups are management-only: not even listed.
	wantStatus(t, do(t, h, "GET", "/api/atlas/backups", nil), http.StatusForbidden)

	// Reads still work, and the runtime says it is not writable.
	wantStatus(t, do(t, h, "GET", "/api/places", nil), http.StatusOK)
	rt := decode[map[string]any](t, do(t, h, "GET", "/api/runtime", nil))
	if rt["writable"] != false {
		t.Errorf("runtime writable = %v", rt["writable"])
	}
}

// --- LAN (remote) clients ---

func TestRemoteClientsAreReadOnly(t *testing.T) {
	s, _ := newTestServer(t, true)
	h := s.Handler()
	place := decode[domain.Place](t, do(t, h, "POST", "/api/places", bordeaux))

	// Viewing works.
	for _, p := range []string{"/api/places", "/api/visits", "/api/wishlist", "/api/media", "/api/profile", "/api/settings", "/api/runtime"} {
		wantStatus(t, do(t, h, "GET", p, nil, fromLAN), http.StatusOK)
	}

	// Every write, every geocode call and every atlas call is refused.
	for _, c := range []struct{ method, path string }{
		{"POST", "/api/places"},
		{"PUT", "/api/places/" + place.ID},
		{"DELETE", "/api/places/" + place.ID},
		{"POST", "/api/visits"},
		{"POST", "/api/wishlist"},
		{"POST", "/api/media"},
		{"PUT", "/api/profile"},
		{"PUT", "/api/settings"},
		{"GET", "/api/geocode/search?q=Bordeaux"},
		{"GET", "/api/geocode/reverse?lat=1&lng=2"},
		{"GET", "/api/atlas/backups"},
		{"POST", "/api/atlas/export"},
		{"POST", "/api/atlas/import"},
		{"POST", "/api/atlas/new"},
		{"POST", "/api/atlas/backups/x.atlas/restore"},
		{"DELETE", "/api/atlas/backups/x.atlas"},
	} {
		w := do(t, h, c.method, c.path, bordeaux, fromLAN)
		if w.Code != http.StatusForbidden {
			t.Errorf("remote %s %s: status %d, want 403", c.method, c.path, w.Code)
			continue
		}
		if msg := errorOf(t, w); msg != remoteReadOnlyMsg {
			t.Errorf("remote %s %s: error = %q", c.method, c.path, msg)
		}
	}

	// Nothing changed.
	if list := decode[[]domain.Place](t, do(t, h, "GET", "/api/places", nil)); len(list) != 1 {
		t.Errorf("remote request modified data: %+v", list)
	}
	// The same geocode call works locally.
	wantStatus(t, do(t, h, "GET", "/api/geocode/search?q=Bordeaux", nil), http.StatusOK)
}

func TestRuntimeReportsRemoteAndLAN(t *testing.T) {
	s, dir := newTestServer(t, true)
	h := s.Handler()

	// No LAN controller: lan is present, disabled, with an empty URL list
	// (never null).
	w := do(t, h, "GET", "/api/runtime", nil)
	if !strings.Contains(w.Body.String(), `"lan":{"enabled":false,"urls":[]}`) {
		t.Errorf("runtime without LAN = %s", w.Body.String())
	}

	ctl := &fakeLAN{state: lan.Status{Enabled: true, URLs: []string{"http://192.168.1.23:4317"}}}
	s.SetLAN(ctl)

	type runtimeInfo struct {
		Mode     string     `json:"mode"`
		Writable bool       `json:"writable"`
		Remote   bool       `json:"remote"`
		Port     int        `json:"port"`
		DataDir  *string    `json:"dataDir"`
		LAN      lan.Status `json:"lan"`
	}
	local := decode[runtimeInfo](t, do(t, h, "GET", "/api/runtime", nil))
	if local.Remote || !local.Writable || local.DataDir == nil || *local.DataDir != dir || local.Port != 4317 {
		t.Errorf("local runtime = %+v", local)
	}
	if !local.LAN.Enabled || len(local.LAN.URLs) != 1 || local.LAN.URLs[0] != "http://192.168.1.23:4317" {
		t.Errorf("local runtime lan = %+v", local.LAN)
	}

	remote := decode[runtimeInfo](t, do(t, h, "GET", "/api/runtime", nil, fromLAN))
	if !remote.Remote || remote.Writable {
		t.Errorf("remote runtime = %+v (want remote=true, writable=false)", remote)
	}
	if remote.DataDir != nil {
		t.Errorf("dataDir leaked to a LAN client: %q", *remote.DataDir)
	}
	if !remote.LAN.Enabled {
		t.Errorf("remote runtime lan = %+v", remote.LAN)
	}
}

// TestSettingsToggleLAN: PUT /api/settings switches LAN sharing live, but
// only when lanSharing actually changes — saving another preference must not
// touch it (e.g. sharing forced on with -lan while the stored flag is false).
func TestSettingsToggleLAN(t *testing.T) {
	s, _ := newTestServer(t, true)
	ctl := &fakeLAN{}
	s.SetLAN(ctl)
	h := s.Handler()

	wantStatus(t, do(t, h, "PUT", "/api/settings", domain.Settings{Theme: "night"}), http.StatusOK)
	if len(ctl.calls) != 0 {
		t.Fatalf("theme change toggled LAN: %v", ctl.calls)
	}
	wantStatus(t, do(t, h, "PUT", "/api/settings", domain.Settings{Theme: "night", LANSharing: true}), http.StatusOK)
	wantStatus(t, do(t, h, "PUT", "/api/settings", domain.Settings{Theme: "light", LANSharing: true}), http.StatusOK)
	wantStatus(t, do(t, h, "PUT", "/api/settings", domain.Settings{Theme: "light"}), http.StatusOK)
	if want := []bool{true, false}; len(ctl.calls) != 2 || ctl.calls[0] != want[0] || ctl.calls[1] != want[1] {
		t.Fatalf("SetEnabled calls = %v, want %v", ctl.calls, want)
	}
	// A LAN client cannot flip it.
	wantStatus(t, do(t, h, "PUT", "/api/settings", domain.Settings{LANSharing: true}, fromLAN), http.StatusForbidden)
	if len(ctl.calls) != 2 {
		t.Fatalf("remote request toggled LAN: %v", ctl.calls)
	}
}

// --- backups ---

func TestBackupsListRestoreDelete(t *testing.T) {
	s, dir := newTestServer(t, true)
	h := s.Handler()

	// Empty: an empty JSON array, not null.
	w := do(t, h, "GET", "/api/atlas/backups", nil)
	wantStatus(t, w, http.StatusOK)
	if strings.TrimSpace(w.Body.String()) != "[]" {
		t.Fatalf("empty list = %s", w.Body.String())
	}

	// State A: one place. Back it up, then change to state B (no places).
	place := decode[domain.Place](t, do(t, h, "POST", "/api/places", bordeaux))
	rel, err := atlas.Backup(dir)
	if err != nil {
		t.Fatal(err)
	}
	backupA := filepath.Base(rel)
	wantStatus(t, do(t, h, "DELETE", "/api/places/"+place.ID, nil), http.StatusOK)

	list := decode[[]atlas.BackupInfo](t, do(t, h, "GET", "/api/atlas/backups", nil))
	if len(list) != 1 || list[0].Name != backupA || list[0].Size <= 0 || list[0].CreatedAt == "" {
		t.Fatalf("list = %+v", list)
	}

	// Restore A: data comes back, and the pre-restore state (B) is itself
	// backed up under a new name (unique even within the same second).
	w = do(t, h, "POST", "/api/atlas/backups/"+backupA+"/restore", nil)
	wantStatus(t, w, http.StatusOK)
	res := decode[map[string]any](t, w)
	pre, _ := res["backup"].(string)
	if res["restored"] != true || pre == "" || pre == backupA || strings.ContainsAny(pre, `/\`) {
		t.Fatalf("restore response = %+v", res)
	}
	if places := decode[[]domain.Place](t, do(t, h, "GET", "/api/places", nil)); len(places) != 1 || places[0].ID != place.ID {
		t.Fatalf("restore did not bring the place back: %+v", places)
	}
	list = decode[[]atlas.BackupInfo](t, do(t, h, "GET", "/api/atlas/backups", nil))
	if len(list) != 2 || list[0].Name != pre || list[1].Name != backupA {
		t.Fatalf("list after restore (want newest first) = %+v", list)
	}
	// No staging leftovers in the data dir.
	entries, _ := os.ReadDir(dir)
	for _, e := range entries {
		if strings.HasPrefix(e.Name(), ".atlas-import-") || strings.Contains(e.Name(), ".old-") || strings.Contains(e.Name(), ".new-") {
			t.Errorf("leftover after restore: %s", e.Name())
		}
	}

	// Delete the pre-restore backup.
	w = do(t, h, "DELETE", "/api/atlas/backups/"+pre, nil)
	wantStatus(t, w, http.StatusOK)
	if got := decode[map[string]string](t, w); got["deleted"] != pre {
		t.Fatalf("delete response = %+v", got)
	}
	list = decode[[]atlas.BackupInfo](t, do(t, h, "GET", "/api/atlas/backups", nil))
	if len(list) != 1 || list[0].Name != backupA {
		t.Fatalf("list after delete = %+v", list)
	}
	wantStatus(t, do(t, h, "DELETE", "/api/atlas/backups/"+pre, nil), http.StatusNotFound)
	wantStatus(t, do(t, h, "POST", "/api/atlas/backups/missing.atlas/restore", nil), http.StatusNotFound)
}

func TestBackupNameValidation(t *testing.T) {
	s, dir := newTestServer(t, true)
	h := s.Handler()
	// A file outside backups/ that a traversal would reach.
	if err := os.WriteFile(filepath.Join(dir, "secret.atlas"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}

	for _, name := range []string{
		"..%2Fsecret.atlas",     // encoded separator: decodes to ../secret.atlas
		"%2E%2E%5Csecret.atlas", // ..\secret.atlas
		"sub%2Fx.atlas",
		".hidden.atlas",
		"backup.zip",
		"backup.atlas.zip",
		".atlas",
		"a%00b.atlas",
		"C:secret.atlas",
	} {
		wantStatus(t, do(t, h, "POST", "/api/atlas/backups/"+name+"/restore", nil), http.StatusBadRequest)
		wantStatus(t, do(t, h, "DELETE", "/api/atlas/backups/"+name, nil), http.StatusBadRequest)
	}
	if _, err := os.Stat(filepath.Join(dir, "secret.atlas")); err != nil {
		t.Fatalf("file outside backups/ was touched: %v", err)
	}

	// A directory or a corrupt file in backups/ is not restorable; the
	// corrupt one fails validation and leaves the Atlas untouched.
	if err := os.MkdirAll(filepath.Join(dir, "backups", "dir.atlas"), 0o755); err != nil {
		t.Fatal(err)
	}
	wantStatus(t, do(t, h, "POST", "/api/atlas/backups/dir.atlas/restore", nil), http.StatusNotFound)
	if err := os.WriteFile(filepath.Join(dir, "backups", "corrupt.atlas"), []byte("not a zip"), 0o644); err != nil {
		t.Fatal(err)
	}
	decode[domain.Place](t, do(t, h, "POST", "/api/places", bordeaux))
	wantStatus(t, do(t, h, "POST", "/api/atlas/backups/corrupt.atlas/restore", nil), http.StatusBadRequest)
	if places := decode[[]domain.Place](t, do(t, h, "GET", "/api/places", nil)); len(places) != 1 {
		t.Fatalf("failed restore modified data: %+v", places)
	}
}
