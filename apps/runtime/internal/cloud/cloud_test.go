package cloud

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/yuatlas/runtime/internal/geocode"
)

// --- test fixtures ---

type stubGeocoder struct{}

func (stubGeocoder) ID() string { return "stub" }
func (stubGeocoder) Search(context.Context, string, geocode.SearchOptions) ([]geocode.Result, error) {
	return []geocode.Result{{Name: "Bordeaux", Provider: "stub"}}, nil
}
func (stubGeocoder) Reverse(context.Context, float64, float64) (*geocode.Result, error) {
	return &geocode.Result{Name: "Bordeaux", Provider: "stub"}, nil
}

const testOrigin = "https://atlas.example.com"

func newTestService(t *testing.T, mutate ...func(*Config)) (*Service, *httptest.Server, string) {
	t.Helper()
	t.Setenv("ATLAS_SESSION_SECRET", "")
	root := t.TempDir()
	cfg := Config{
		Root:        root,
		Origins:     []string{testOrigin},
		AllowSignup: true,
		QuotaBytes:  500 << 20,
		Geocoder:    geocode.NewManager(stubGeocoder{}),
		Static: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			_, _ = io.WriteString(w, "<!doctype html><title>Atlas</title>")
		}),
	}
	for _, m := range mutate {
		m(&cfg)
	}
	svc, err := New(cfg)
	if err != nil {
		t.Fatal(err)
	}
	ts := httptest.NewServer(svc.Handler())
	t.Cleanup(ts.Close)
	return svc, ts, root
}

// client is one browser: its own cookie jar, sending the app's Origin on
// writes like a real same-origin page would.
type client struct {
	t    *testing.T
	base string
	http *http.Client
}

func newClient(t *testing.T, ts *httptest.Server) *client {
	jar, _ := cookiejar.New(nil)
	return &client{t: t, base: ts.URL, http: &http.Client{Jar: jar}}
}

type resp struct {
	status int
	body   []byte
	header http.Header
}

func (r resp) json(t *testing.T, v any) {
	t.Helper()
	if err := json.Unmarshal(r.body, v); err != nil {
		t.Fatalf("decode %q: %v", r.body, err)
	}
}

func (c *client) do(method, path string, body any, headers ...string) resp {
	c.t.Helper()
	var rd io.Reader
	ctype := ""
	switch b := body.(type) {
	case nil:
	case *multipartBody:
		rd, ctype = bytes.NewReader(b.buf.Bytes()), b.ctype
	default:
		buf, _ := json.Marshal(b)
		rd, ctype = bytes.NewReader(buf), "application/json"
	}
	req, err := http.NewRequest(method, c.base+path, rd)
	if err != nil {
		c.t.Fatal(err)
	}
	if ctype != "" {
		req.Header.Set("Content-Type", ctype)
	}
	if method != http.MethodGet {
		req.Header.Set("Origin", testOrigin)
	}
	for i := 0; i+1 < len(headers); i += 2 {
		req.Header.Set(headers[i], headers[i+1])
	}
	res, err := c.http.Do(req)
	if err != nil {
		c.t.Fatal(err)
	}
	defer res.Body.Close()
	b, _ := io.ReadAll(res.Body)
	return resp{status: res.StatusCode, body: b, header: res.Header}
}

func want(t *testing.T, r resp, status int) {
	t.Helper()
	if r.status != status {
		t.Fatalf("status = %d, want %d; body: %s", r.status, status, r.body)
	}
}

type multipartBody struct {
	buf   bytes.Buffer
	ctype string
}

func imageUpload(t *testing.T, name string, data []byte) *multipartBody {
	t.Helper()
	m := &multipartBody{}
	mw := multipart.NewWriter(&m.buf)
	fw, err := mw.CreateFormFile("file", name)
	if err != nil {
		t.Fatal(err)
	}
	_, _ = fw.Write(data)
	_ = mw.Close()
	m.ctype = mw.FormDataContentType()
	return m
}

func (c *client) register(email, password string) PublicUser {
	c.t.Helper()
	r := c.do("POST", "/api/auth/register", credentials{Email: email, Password: password})
	want(c.t, r, http.StatusCreated)
	var out struct{ User PublicUser }
	r.json(c.t, &out)
	return out.User
}

// --- unit tests ---

func TestPasswordHashVerify(t *testing.T) {
	h, err := HashPassword("correct horse battery")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(h, "$argon2id$v=19$m=19456,t=2,p=1$") {
		t.Errorf("unexpected encoding: %s", h)
	}
	if ok, err := VerifyPassword(h, "correct horse battery"); err != nil || !ok {
		t.Errorf("right password rejected: %v %v", ok, err)
	}
	if ok, _ := VerifyPassword(h, "correct horse batterY"); ok {
		t.Error("wrong password accepted")
	}
	h2, _ := HashPassword("correct horse battery")
	if h2 == h {
		t.Error("salt not random: identical hashes")
	}
	for _, bad := range []string{"", "plain", "$argon2id$v=19$m=1,t=1$x$y", "$bcrypt$v=19$m=1,t=1,p=1$AAAA$AAAA"} {
		if _, err := VerifyPassword(bad, "x"); err == nil {
			t.Errorf("malformed hash %q accepted", bad)
		}
	}
}

func TestNormalizeEmail(t *testing.T) {
	if e, err := NormalizeEmail("  Li.Hua@Example.COM "); err != nil || e != "li.hua@example.com" {
		t.Errorf("got %q %v", e, err)
	}
	for _, bad := range []string{"", "nobody", "a@b", "Li <li@example.com>", "a@@example.com"} {
		if _, err := NormalizeEmail(bad); err == nil {
			t.Errorf("%q accepted", bad)
		}
	}
}

func TestSessionCookie(t *testing.T) {
	s := NewSessions([]byte(strings.Repeat("k", 32)))
	now := time.Unix(1_800_000_000, 0)
	s.now = func() time.Time { return now }

	v, exp := s.Issue("u1", 3)
	if exp.Sub(now) != sessionTTL {
		t.Errorf("ttl = %v", exp.Sub(now))
	}
	c, err := s.Parse(v)
	if err != nil || c.UID != "u1" || c.Version != 3 {
		t.Fatalf("parse: %+v %v", c, err)
	}

	// Tampering with the payload (another user id) breaks the signature.
	payload, sig, _ := strings.Cut(v, ".")
	forged := strings.Replace(payload, payload[:4], "eyJ1", 1)
	other, _ := s.Issue("u2", 3)
	otherPayload, _, _ := strings.Cut(other, ".")
	for _, bad := range []string{"", "x", payload, payload + ".", otherPayload + "." + sig, forged + "x." + sig, v + "x"} {
		if _, err := s.Parse(bad); err == nil {
			t.Errorf("tampered cookie %q accepted", bad)
		}
	}

	// Another secret cannot verify it.
	if _, err := NewSessions([]byte(strings.Repeat("j", 32))).Parse(v); err == nil {
		t.Error("cookie verified with a different secret")
	}

	// Expiry.
	now = now.Add(sessionTTL + time.Second)
	if _, err := s.Parse(v); err != errExpiredSession {
		t.Errorf("expired cookie: %v", err)
	}
}

func TestLoadSecretPersists(t *testing.T) {
	t.Setenv("ATLAS_SESSION_SECRET", "")
	root := t.TempDir()
	a, err := LoadSecret(root)
	if err != nil {
		t.Fatal(err)
	}
	b, err := LoadSecret(root)
	if err != nil || !bytes.Equal(a, b) || len(a) != 32 {
		t.Fatalf("secret not stable: %x %x %v", a, b, err)
	}
	info, _ := os.Stat(filepath.Join(root, "secret.key"))
	if info.Mode().Perm() != 0o600 {
		t.Errorf("secret.key mode = %v", info.Mode().Perm())
	}
	t.Setenv("ATLAS_SESSION_SECRET", "short")
	if _, err := LoadSecret(root); err == nil {
		t.Error("short env secret accepted")
	}
}

// --- HTTP flows ---

func TestRegisterLoginLogout(t *testing.T) {
	_, ts, root := newTestService(t)
	c := newClient(t, ts)

	var rt map[string]any
	c.do("GET", "/api/runtime", nil).json(t, &rt)
	if rt["mode"] != "cloud" || rt["authenticated"] != false || rt["writable"] != false {
		t.Fatalf("anonymous runtime: %v", rt)
	}
	if _, ok := rt["dataDir"]; ok {
		t.Error("runtime exposes dataDir")
	}

	want(t, c.do("POST", "/api/auth/register", credentials{Email: "a@example.com", Password: "short"}), http.StatusBadRequest)
	want(t, c.do("POST", "/api/auth/register", credentials{Email: "not-an-email", Password: "long enough"}), http.StatusBadRequest)

	u := c.register("A@Example.com", "password-a")
	if u.Email != "a@example.com" || len(u.ID) != 32 {
		t.Fatalf("user: %+v", u)
	}
	if _, err := os.Stat(filepath.Join(root, "users", u.ID, "data", "places.json")); err != nil {
		t.Errorf("atlas not created on sign-up: %v", err)
	}
	want(t, c.do("POST", "/api/auth/register", credentials{Email: "a@example.com", Password: "password-x"}), http.StatusConflict)

	c.do("GET", "/api/runtime", nil).json(t, &rt)
	if rt["authenticated"] != true || rt["writable"] != true {
		t.Fatalf("signed-in runtime: %v", rt)
	}
	want(t, c.do("GET", "/api/places", nil), http.StatusOK)

	want(t, c.do("POST", "/api/auth/logout", nil), http.StatusOK)
	want(t, c.do("GET", "/api/places", nil), http.StatusUnauthorized)
	want(t, c.do("GET", "/api/auth/me", nil), http.StatusUnauthorized)

	r := c.do("POST", "/api/auth/login", credentials{Email: "a@example.com", Password: "wrong-password"})
	want(t, r, http.StatusUnauthorized)
	r2 := c.do("POST", "/api/auth/login", credentials{Email: "ghost@example.com", Password: "wrong-password"})
	want(t, r2, http.StatusUnauthorized)
	if !bytes.Equal(r.body, r2.body) {
		t.Errorf("login errors differ for unknown email: %s vs %s", r.body, r2.body)
	}

	want(t, c.do("POST", "/api/auth/login", credentials{Email: " a@EXAMPLE.com", Password: "password-a"}), http.StatusOK)
	var me struct {
		User  PublicUser
		Usage struct{ Bytes, QuotaBytes int64 }
	}
	r = c.do("GET", "/api/auth/me", nil)
	want(t, r, http.StatusOK)
	r.json(t, &me)
	if me.User.ID != u.ID || me.Usage.QuotaBytes != 500<<20 || me.Usage.Bytes <= 0 {
		t.Errorf("me: %+v", me)
	}
}

func TestCookieAttributes(t *testing.T) {
	_, ts, _ := newTestService(t)
	req, _ := http.NewRequest("POST", ts.URL+"/api/auth/register",
		strings.NewReader(`{"email":"c@example.com","password":"password-c"}`))
	req.Host = "atlas.example.com" // addressed to the https origin
	req.Header.Set("Content-Type", "application/json")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	sc := res.Header.Get("Set-Cookie")
	for _, attr := range []string{"atlas_session=", "HttpOnly", "Secure", "SameSite=Lax", "Path=/"} {
		if !strings.Contains(sc, attr) {
			t.Errorf("Set-Cookie %q lacks %s", sc, attr)
		}
	}
}

func TestUnauthenticated(t *testing.T) {
	_, ts, _ := newTestService(t)
	c := newClient(t, ts)
	for _, p := range []string{"/api/places", "/api/profile", "/api/settings", "/api/atlas/backups", "/media/misc/x.jpg", "/api/geocode/search?q=a"} {
		want(t, c.do("GET", p, nil), http.StatusUnauthorized)
	}
	want(t, c.do("POST", "/api/places", map[string]any{"name": "x"}), http.StatusUnauthorized)
	want(t, c.do("POST", "/api/atlas/export", nil), http.StatusUnauthorized)
	// The frontend itself is public.
	want(t, c.do("GET", "/", nil), http.StatusOK)

	// A forged cookie for a real user is not a session.
	_, ts2, _ := newTestService(t)
	c2 := newClient(t, ts2)
	u := c2.register("v@example.com", "password-v")
	forger := NewSessions([]byte(strings.Repeat("z", 32)))
	val, _ := forger.Issue(u.ID, 1)
	req, _ := http.NewRequest("GET", ts2.URL+"/api/places", nil)
	req.AddCookie(&http.Cookie{Name: sessionCookie, Value: val})
	res, _ := http.DefaultClient.Do(req)
	res.Body.Close()
	if res.StatusCode != http.StatusUnauthorized {
		t.Errorf("forged cookie: %d", res.StatusCode)
	}
}

func TestCrossUserIsolation(t *testing.T) {
	_, ts, root := newTestService(t)
	a, b := newClient(t, ts), newClient(t, ts)
	ua := a.register("a@example.com", "password-a")
	ub := b.register("b@example.com", "password-b")

	place := map[string]any{"name": "Bordeaux", "country": "France", "countryCode": "FR", "type": "city",
		"coordinates": map[string]float64{"lat": 44.84, "lng": -0.58}}
	want(t, a.do("POST", "/api/places", place), http.StatusCreated)

	r := a.do("POST", "/api/media", imageUpload(t, "secret.jpg", []byte("JPEGDATA-A")))
	want(t, r, http.StatusCreated)
	var m struct{ ID, Path string }
	r.json(t, &m)
	if !strings.HasPrefix(m.Path, "/media/") {
		t.Fatalf("media path %q", m.Path)
	}

	var places []map[string]any
	b.do("GET", "/api/places", nil).json(t, &places)
	if len(places) != 0 {
		t.Errorf("B sees A's places: %v", places)
	}
	var media []map[string]any
	b.do("GET", "/api/media", nil).json(t, &media)
	if len(media) != 0 {
		t.Errorf("B sees A's media records: %v", media)
	}
	want(t, b.do("GET", m.Path, nil), http.StatusNotFound)
	want(t, b.do("GET", m.Path+"?w=320", nil), http.StatusNotFound)
	want(t, b.do("DELETE", "/api/media/"+m.ID, nil), http.StatusNotFound)

	// Traversal towards A's directory from B's media root.
	for _, p := range []string{"/media/../../" + ua.ID + "/media" + strings.TrimPrefix(m.Path, "/media"),
		"/media/..%2F..%2F" + ua.ID + "%2Fmedia%2Fmisc%2Fsecret.jpg"} {
		if r := b.do("GET", p, nil); r.status == http.StatusOK && bytes.Contains(r.body, []byte("JPEGDATA-A")) {
			t.Errorf("traversal %s leaked A's photo", p)
		}
	}

	// A still sees its own.
	r = a.do("GET", m.Path, nil)
	want(t, r, http.StatusOK)
	if string(r.body) != "JPEGDATA-A" {
		t.Errorf("A's photo: %q", r.body)
	}
	if cc := r.header.Get("Cache-Control"); !strings.Contains(cc, "private") {
		t.Errorf("media Cache-Control = %q", cc)
	}
	if _, err := os.Stat(filepath.Join(root, "users", ub.ID, "media")); err == nil {
		entries, _ := os.ReadDir(filepath.Join(root, "users", ub.ID, "media"))
		if len(entries) != 0 {
			t.Errorf("B's media dir not empty: %v", entries)
		}
	}
}

func TestCrossOriginWriteRejected(t *testing.T) {
	_, ts, _ := newTestService(t)
	c := newClient(t, ts)
	c.register("a@example.com", "password-a")
	place := map[string]any{"name": "X", "type": "city", "coordinates": map[string]float64{"lat": 1, "lng": 1}}

	want(t, c.do("POST", "/api/places", place, "Origin", "https://evil.example"), http.StatusForbidden)
	want(t, c.do("DELETE", "/api/auth/account", map[string]string{"password": "password-a"}, "Origin", "null"), http.StatusForbidden)
	want(t, c.do("POST", "/api/places", place, "Origin", "", "Sec-Fetch-Site", "cross-site"), http.StatusForbidden)
	// Login CSRF too.
	want(t, c.do("POST", "/api/auth/login", credentials{Email: "a@example.com", Password: "password-a"}, "Origin", "https://evil.example"), http.StatusForbidden)

	// CORS is reflected (with credentials) only for configured origins.
	r := c.do("GET", "/api/runtime", nil, "Origin", testOrigin)
	if r.header.Get("Access-Control-Allow-Origin") != testOrigin || r.header.Get("Access-Control-Allow-Credentials") != "true" {
		t.Errorf("CORS for configured origin: %v", r.header)
	}
	r = c.do("GET", "/api/runtime", nil, "Origin", "https://evil.example")
	if r.header.Get("Access-Control-Allow-Origin") != "" {
		t.Errorf("CORS reflected for unknown origin")
	}
	for k, v := range map[string]string{"X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY", "Referrer-Policy": "strict-origin-when-cross-origin"} {
		if r.header.Get(k) != v {
			t.Errorf("%s = %q", k, r.header.Get(k))
		}
	}

	// Unknown Host names are refused.
	req, _ := http.NewRequest("GET", ts.URL+"/api/runtime", nil)
	req.Host = "evil.example"
	res, _ := http.DefaultClient.Do(req)
	res.Body.Close()
	if res.StatusCode != http.StatusForbidden {
		t.Errorf("unknown Host: %d", res.StatusCode)
	}
}

func TestSignOutEverywhereAndPasswordChange(t *testing.T) {
	_, ts, _ := newTestService(t)
	laptop, phone := newClient(t, ts), newClient(t, ts)
	laptop.register("a@example.com", "password-a")
	want(t, phone.do("POST", "/api/auth/login", credentials{Email: "a@example.com", Password: "password-a"}), http.StatusOK)

	// Password change: the laptop (which changed it) stays in, the phone is out.
	want(t, laptop.do("POST", "/api/auth/password", map[string]string{"currentPassword": "nope-nope", "newPassword": "password-b"}), http.StatusForbidden)
	want(t, laptop.do("POST", "/api/auth/password", map[string]string{"currentPassword": "password-a", "newPassword": "password-b"}), http.StatusOK)
	want(t, laptop.do("GET", "/api/places", nil), http.StatusOK)
	want(t, phone.do("GET", "/api/places", nil), http.StatusUnauthorized)
	want(t, phone.do("POST", "/api/auth/login", credentials{Email: "a@example.com", Password: "password-a"}), http.StatusUnauthorized)
	want(t, phone.do("POST", "/api/auth/login", credentials{Email: "a@example.com", Password: "password-b"}), http.StatusOK)

	// Sign out everywhere.
	want(t, phone.do("POST", "/api/auth/logout", map[string]bool{"everywhere": true}), http.StatusOK)
	want(t, laptop.do("GET", "/api/places", nil), http.StatusUnauthorized)
	want(t, phone.do("GET", "/api/places", nil), http.StatusUnauthorized)
}

func TestDeleteAccount(t *testing.T) {
	svc, ts, root := newTestService(t)
	a, b := newClient(t, ts), newClient(t, ts)
	ua := a.register("a@example.com", "password-a")
	b.register("b@example.com", "password-b")
	want(t, a.do("POST", "/api/media", imageUpload(t, "p.jpg", []byte("JPEG"))), http.StatusCreated)
	// Make a thumbnail cache dir exist.
	_ = os.MkdirAll(svc.thumbDir(ua.ID), 0o755)

	want(t, a.do("DELETE", "/api/auth/account", map[string]string{"password": "wrong-pass"}), http.StatusForbidden)
	want(t, a.do("DELETE", "/api/auth/account", map[string]string{"password": "password-a"}), http.StatusOK)

	for _, p := range []string{filepath.Join(root, "users", ua.ID), svc.thumbDir(ua.ID)} {
		if _, err := os.Stat(p); !os.IsNotExist(err) {
			t.Errorf("%s still exists (%v)", p, err)
		}
	}
	if _, ok := svc.users.ByEmail("a@example.com"); ok {
		t.Error("account record kept")
	}
	want(t, a.do("GET", "/api/places", nil), http.StatusUnauthorized)
	want(t, a.do("POST", "/api/auth/login", credentials{Email: "a@example.com", Password: "password-a"}), http.StatusUnauthorized)
	// The other account is untouched.
	want(t, b.do("GET", "/api/places", nil), http.StatusOK)

	// The account list survives a restart without the deleted user.
	store, err := OpenUserStore(root)
	if err != nil || store.Count() != 1 {
		t.Errorf("users.json after delete: %d %v", store.Count(), err)
	}
}

func TestSignupClosed(t *testing.T) {
	_, ts, _ := newTestService(t, func(c *Config) { c.AllowSignup = false })
	c := newClient(t, ts)
	want(t, c.do("POST", "/api/auth/register", credentials{Email: "a@example.com", Password: "password-a"}), http.StatusForbidden)
	var rt map[string]any
	c.do("GET", "/api/runtime", nil).json(t, &rt)
	if rt["allowSignup"] != false {
		t.Errorf("runtime allowSignup = %v", rt["allowSignup"])
	}
}

func TestQuota(t *testing.T) {
	_, ts, _ := newTestService(t, func(c *Config) { c.QuotaBytes = 64 << 10 })
	c := newClient(t, ts)
	c.register("a@example.com", "password-a")
	// Too large for what is left of the quota: refused up front.
	r := c.do("POST", "/api/media", imageUpload(t, "big.jpg", bytes.Repeat([]byte{1}, 80<<10)))
	want(t, r, http.StatusRequestEntityTooLarge)
	if !strings.Contains(string(r.body), "quota") {
		t.Errorf("quota message: %s", r.body)
	}
	// Fits.
	want(t, c.do("POST", "/api/media", imageUpload(t, "a.jpg", bytes.Repeat([]byte{1}, 40<<10))), http.StatusCreated)
	// Now full.
	want(t, c.do("POST", "/api/media", imageUpload(t, "b.jpg", bytes.Repeat([]byte{1}, 30<<10))), http.StatusRequestEntityTooLarge)
}

func TestJSONBodyLimit(t *testing.T) {
	_, ts, _ := newTestService(t)
	c := newClient(t, ts)
	c.register("a@example.com", "password-a")
	huge := map[string]string{"name": strings.Repeat("x", 2<<20)}
	r := c.do("PUT", "/api/profile", huge)
	if r.status < 400 {
		t.Errorf("2 MB JSON accepted: %d", r.status)
	}
}

func TestLoginRateLimit(t *testing.T) {
	_, ts, _ := newTestService(t)
	c := newClient(t, ts)
	c.register("a@example.com", "password-a")
	var last resp
	for i := 0; i < 11; i++ {
		last = c.do("POST", "/api/auth/login", credentials{Email: "a@example.com", Password: "wrong-password"})
	}
	want(t, last, http.StatusTooManyRequests)
	if last.header.Get("Retry-After") == "" {
		t.Error("no Retry-After")
	}
	// Even the right password is held off until the window passes.
	want(t, c.do("POST", "/api/auth/login", credentials{Email: "a@example.com", Password: "password-a"}), http.StatusTooManyRequests)
}

func TestGeocodeRateLimit(t *testing.T) {
	svc, ts, _ := newTestService(t)
	svc.geo = newLimiter(3, time.Minute)
	c := newClient(t, ts)
	c.register("a@example.com", "password-a")
	for i := 0; i < 3; i++ {
		want(t, c.do("GET", "/api/geocode/search?q=bordeaux", nil), http.StatusOK)
	}
	want(t, c.do("GET", "/api/geocode/search?q=bordeaux", nil), http.StatusTooManyRequests)
}

func TestClientIP(t *testing.T) {
	s := &Service{cfg: Config{TrustProxy: true}}
	r := httptest.NewRequest("GET", "/", nil)
	r.RemoteAddr = "127.0.0.1:5000"
	r.Header.Set("X-Forwarded-For", "6.6.6.6, 203.0.113.9")
	if got := s.clientIP(r); got != "203.0.113.9" {
		t.Errorf("behind proxy: %s", got)
	}
	r.RemoteAddr = "198.51.100.1:5000" // not our proxy: header ignored
	if got := s.clientIP(r); got != "198.51.100.1" {
		t.Errorf("direct: %s", got)
	}
	s.cfg.TrustProxy = false
	r.RemoteAddr = "127.0.0.1:5000"
	if got := s.clientIP(r); got != "127.0.0.1" {
		t.Errorf("untrusted proxy: %s", got)
	}
}

func TestParseOrigins(t *testing.T) {
	got, err := ParseOrigins(" https://Atlas.Example.com , http://localhost:3000/")
	if err != nil || len(got) != 2 || got[0] != "https://atlas.example.com" || got[1] != "http://localhost:3000" {
		t.Errorf("got %v %v", got, err)
	}
	for _, bad := range []string{"atlas.example.com", "ftp://x", "https://x/app", "https://u:p@x"} {
		if _, err := ParseOrigins(bad); err == nil {
			t.Errorf("%q accepted", bad)
		}
	}
}
