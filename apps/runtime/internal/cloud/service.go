// Package cloud is the multi-user ("cloud") mode of the runtime: accounts,
// sessions and one private Atlas per user, served over the internet behind
// a TLS reverse proxy.
//
// Every user's Atlas is a complete atlas-data directory at
// <root>/users/<id>/, handled by exactly the same api.Server and media
// handler as the local single-user runtime. This package only adds what a
// public server needs around them:
//
//   - accounts (users.go, password.go) and signed session cookies
//     (session.go);
//   - routing of /api/* and /media/* to the signed-in user's handlers, so a
//     user can never address another user's data: there is no user id in
//     any data URL, it comes from the session alone;
//   - the public-internet access rules (protect): Host and Origin checks,
//     credentialed CORS for the configured origins only, security headers,
//     body size limits;
//   - abuse limits: login / sign-up rate limits per IP and per email, a
//     geocoding rate limit per user, a per-user storage quota.
package cloud

import (
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"log"
	"mime"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/yuatlas/runtime/internal/api"
	"github.com/yuatlas/runtime/internal/geocode"
	"github.com/yuatlas/runtime/internal/media"
	"github.com/yuatlas/runtime/internal/storage"
)

const (
	jsonBodyLimit    = 1 << 20   // every non-upload API request
	mediaUploadLimit = 26 << 20  // api.Server reads at most 25 MB per image
	importLimit      = 513 << 20 // api.Server's 512 MB import ceiling
)

type Config struct {
	// Root holds users.json, secret.key, users/<id>/ and cache/.
	Root string
	// Origins are the public origins the frontend is served from
	// ("https://atlas.example.com"); see ParseOrigins.
	Origins []string
	// AllowSignup lets anyone create an account.
	AllowSignup bool
	// QuotaBytes caps each user's directory (photos, data, backups);
	// 0 means unlimited.
	QuotaBytes int64
	// TrustProxy takes the client IP from X-Forwarded-For and the scheme
	// from X-Forwarded-Proto — only for connections from loopback, i.e. a
	// reverse proxy on the same machine.
	TrustProxy bool
	Geocoder   *geocode.Manager
	// Static serves the frontend; nil answers 404.
	Static http.Handler
}

type Service struct {
	cfg      Config
	users    *UserStore
	sessions *Sessions
	// originScheme maps each configured origin's host[:port] to its scheme.
	originScheme map[string]string
	origins      map[string]bool

	mu   sync.Mutex
	pool map[string]*tenant

	loginIP, loginEmail, signupIP, geo *limiter
}

// tenant is one user's live handlers. Requests hold mu for reading; account
// deletion takes it for writing, so it waits for in-flight requests and no
// request can recreate files after the directory is gone.
type tenant struct {
	mu      sync.RWMutex
	deleted bool
	dir     string
	thumbs  string
	api     http.Handler
	media   http.Handler
}

// ParseOrigins splits a comma-separated origin list and normalizes each
// entry to scheme://host[:port] (lowercase, no path).
func ParseOrigins(list string) ([]string, error) {
	var out []string
	for _, raw := range strings.Split(list, ",") {
		raw = strings.TrimSpace(raw)
		if raw == "" {
			continue
		}
		u, err := url.Parse(raw)
		if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" ||
			(u.Path != "" && u.Path != "/") || u.RawQuery != "" || u.User != nil {
			return nil, fmt.Errorf("invalid origin %q: expected scheme://host[:port]", raw)
		}
		out = append(out, strings.ToLower(u.Scheme+"://"+u.Host))
	}
	return out, nil
}

func New(cfg Config) (*Service, error) {
	if cfg.Geocoder == nil {
		return nil, errors.New("cloud: Geocoder is required")
	}
	if err := os.MkdirAll(filepath.Join(cfg.Root, "users"), 0o755); err != nil {
		return nil, err
	}
	users, err := OpenUserStore(cfg.Root)
	if err != nil {
		return nil, fmt.Errorf("open users.json: %w", err)
	}
	secret, err := LoadSecret(cfg.Root)
	if err != nil {
		return nil, err
	}
	s := &Service{
		cfg:          cfg,
		users:        users,
		sessions:     NewSessions(secret),
		originScheme: map[string]string{},
		origins:      map[string]bool{},
		pool:         map[string]*tenant{},
		loginIP:      newLimiter(20, 15*time.Minute),
		loginEmail:   newLimiter(10, 15*time.Minute),
		signupIP:     newLimiter(10, time.Hour),
		geo:          newLimiter(60, time.Minute),
	}
	for _, o := range cfg.Origins {
		u, err := url.Parse(o)
		if err != nil {
			return nil, err
		}
		s.origins[o] = true
		s.originScheme[strings.ToLower(u.Host)] = u.Scheme
	}
	return s, nil
}

// Users exposes the account store (for logs and tests).
func (s *Service) Users() *UserStore { return s.users }

func (s *Service) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/runtime", s.handleRuntime)
	mux.HandleFunc("POST /api/auth/register", s.handleRegister)
	mux.HandleFunc("POST /api/auth/login", s.handleLogin)
	mux.HandleFunc("POST /api/auth/logout", s.handleLogout)
	mux.HandleFunc("GET /api/auth/me", s.handleMe)
	mux.HandleFunc("POST /api/auth/password", s.handlePassword)
	mux.HandleFunc("DELETE /api/auth/account", s.handleDeleteAccount)
	mux.HandleFunc("/api/auth/", func(w http.ResponseWriter, r *http.Request) {
		writeError(w, http.StatusNotFound, "not found")
	})
	mux.Handle("/api/", s.userHandler(false))
	mux.Handle("/media/", s.userHandler(true))
	if s.cfg.Static != nil {
		mux.Handle("/", s.cfg.Static)
	}
	return s.protect(mux)
}

// --- JSON helpers ---

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

func decode(r *http.Request, v any) error {
	defer r.Body.Close()
	return json.NewDecoder(r.Body).Decode(v)
}

// --- sessions ---

// authenticate returns the signed-in user, renewing a session that is past
// half its lifetime.
func (s *Service) authenticate(w http.ResponseWriter, r *http.Request) (User, bool) {
	c, err := r.Cookie(sessionCookie)
	if err != nil {
		return User{}, false
	}
	claims, err := s.sessions.Parse(c.Value)
	if err != nil {
		return User{}, false
	}
	u, ok := s.users.Get(claims.UID)
	if !ok || u.SessionVersion != claims.Version {
		return User{}, false
	}
	if time.Until(time.Unix(claims.Expires, 0)) < sessionRenewBelow {
		s.setSession(w, r, u)
	}
	return u, true
}

func (s *Service) setSession(w http.ResponseWriter, r *http.Request, u User) {
	value, exp := s.sessions.Issue(u.ID, u.SessionVersion)
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookie,
		Value:    value,
		Path:     "/",
		Expires:  exp,
		MaxAge:   int(sessionTTL / time.Second),
		HttpOnly: true,
		Secure:   s.secure(r),
		SameSite: http.SameSiteLaxMode,
	})
}

func (s *Service) clearSession(w http.ResponseWriter, r *http.Request) {
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookie,
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		HttpOnly: true,
		Secure:   s.secure(r),
		SameSite: http.SameSiteLaxMode,
	})
}

// secure decides the cookie's Secure flag: the scheme of the configured
// origin this request was addressed to, else whether it arrived over TLS.
func (s *Service) secure(r *http.Request) bool {
	if scheme, ok := s.originScheme[strings.ToLower(r.Host)]; ok {
		return scheme == "https"
	}
	if r.TLS != nil {
		return true
	}
	return s.cfg.TrustProxy && fromLoopback(r) && strings.EqualFold(r.Header.Get("X-Forwarded-Proto"), "https")
}

// --- per-user routing ---

func (s *Service) userDir(id string) string  { return filepath.Join(s.cfg.Root, "users", id) }
func (s *Service) thumbDir(id string) string { return filepath.Join(s.cfg.Root, "cache", "thumbs", id) }

// tenant returns (creating on first use) the handlers for user id, or false
// when the account does not exist (any more).
func (s *Service) tenant(id string) (*tenant, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if t := s.pool[id]; t != nil {
		return t, true
	}
	if _, ok := s.users.Get(id); !ok {
		return nil, false
	}
	dir := s.userDir(id)
	repo := storage.NewRepository(dir)
	if err := repo.Ensure(); err != nil {
		log.Printf("cloud: initialize %s: %v", dir, err)
		return nil, false
	}
	srv := api.NewServer(repo, s.cfg.Geocoder, dir, 0, true)
	srv.DisableRemoteGate()
	t := &tenant{
		dir:    dir,
		thumbs: s.thumbDir(id),
		api:    srv.Handler(),
		media:  media.NewHandler(dir, media.NewThumbnailer(s.thumbDir(id))),
	}
	s.pool[id] = t
	return t, true
}

// userHandler routes /api/* (isMedia=false) or /media/* to the signed-in
// user's own handlers. Unauthenticated requests get 401.
func (s *Service) userHandler(isMedia bool) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		u, ok := s.authenticate(w, r)
		if !ok {
			writeError(w, http.StatusUnauthorized, "sign in required")
			return
		}
		t, ok := s.tenant(u.ID)
		if !ok {
			writeError(w, http.StatusUnauthorized, "sign in required")
			return
		}
		t.mu.RLock()
		defer t.mu.RUnlock()
		if t.deleted {
			writeError(w, http.StatusUnauthorized, "sign in required")
			return
		}
		if isMedia {
			t.media.ServeHTTP(&privateCache{ResponseWriter: w}, r)
			return
		}
		if !s.admit(w, r, u, t) {
			return
		}
		t.api.ServeHTTP(w, r)
	})
}

// admit applies the per-user limits before an API request reaches the
// user's api.Server: the geocoding rate limit, the storage quota for
// requests that add files, and upload size limits.
func (s *Service) admit(w http.ResponseWriter, r *http.Request, u User, t *tenant) bool {
	p := r.URL.Path
	if strings.HasPrefix(p, "/api/geocode/") {
		if ok, wait := s.geo.allow(u.ID); !ok {
			tooMany(w, wait, "too many place searches; try again in a moment")
			return false
		}
	}

	var limit int64 = jsonBodyLimit
	grows := false // the request adds files to the user's directory
	if r.Method == http.MethodPost {
		switch {
		case p == "/api/media":
			limit, grows = mediaUploadLimit, true
		case p == "/api/atlas/import":
			limit, grows = importLimit, true
		case p == "/api/atlas/new", strings.HasPrefix(p, "/api/atlas/backups/"):
			grows = true // both write a backup of the current Atlas first
		}
	}
	quotaBound := false // limit is what is left of the quota
	if grows && s.cfg.QuotaBytes > 0 {
		used, err := dirSize(t.dir)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return false
		}
		remaining := s.cfg.QuotaBytes - used
		if remaining <= 0 {
			writeError(w, http.StatusRequestEntityTooLarge, s.quotaMessage())
			return false
		}
		if limit > jsonBodyLimit && remaining < limit {
			limit, quotaBound = remaining, true
		}
	}
	if r.ContentLength > limit {
		msg := "request too large"
		if quotaBound {
			msg = s.quotaMessage()
		}
		writeError(w, http.StatusRequestEntityTooLarge, msg)
		return false
	}
	// protect already capped non-multipart bodies at jsonBodyLimit.
	if isMultipart(r) {
		r.Body = http.MaxBytesReader(w, r.Body, limit)
	}
	return true
}

// privateCache marks every media response private, overriding the local
// runtime's "public" thumbnails: photos belong to one signed-in user and
// must never be kept by a shared cache (a CDN or caching proxy).
type privateCache struct {
	http.ResponseWriter
	wrote bool
}

func (p *privateCache) WriteHeader(code int) {
	if !p.wrote {
		p.wrote = true
		p.Header().Set("Cache-Control", "private, max-age=86400")
	}
	p.ResponseWriter.WriteHeader(code)
}

func (p *privateCache) Write(b []byte) (int, error) {
	if !p.wrote {
		p.WriteHeader(http.StatusOK)
	}
	return p.ResponseWriter.Write(b)
}

func (s *Service) quotaMessage() string {
	return fmt.Sprintf("storage quota exceeded (%d MB): delete photos or old backups to free space", s.cfg.QuotaBytes>>20)
}

func tooMany(w http.ResponseWriter, wait time.Duration, msg string) {
	secs := int(wait.Seconds()) + 1
	w.Header().Set("Retry-After", fmt.Sprint(secs))
	writeError(w, http.StatusTooManyRequests, msg)
}

// dirSize sums the sizes of the regular files below dir.
func dirSize(dir string) (int64, error) {
	var total int64
	err := filepath.WalkDir(dir, func(_ string, d fs.DirEntry, err error) error {
		if err != nil {
			if errors.Is(err, fs.ErrNotExist) {
				return nil
			}
			return err
		}
		if d.Type().IsRegular() {
			if info, err := d.Info(); err == nil {
				total += info.Size()
			}
		}
		return nil
	})
	return total, err
}

// --- access rules for the public internet ---

func isMultipart(r *http.Request) bool {
	mt, _, _ := mime.ParseMediaType(r.Header.Get("Content-Type"))
	return mt == "multipart/form-data"
}

func isWriteMethod(m string) bool {
	return m != http.MethodGet && m != http.MethodHead && m != http.MethodOptions
}

// allowedHost accepts the configured origins' hosts, plus localhost and IP
// literals (health checks, direct access on the server itself). Unknown
// names are refused, so the runtime never answers for a domain it was not
// configured for.
func (s *Service) allowedHost(hostport string) bool {
	if hostport == "" {
		return true
	}
	if _, ok := s.originScheme[strings.ToLower(hostport)]; ok {
		return true
	}
	host := hostport
	if h, _, err := net.SplitHostPort(hostport); err == nil {
		host = h
	} else {
		host = strings.TrimSuffix(strings.TrimPrefix(host, "["), "]")
	}
	return strings.EqualFold(host, "localhost") || net.ParseIP(host) != nil
}

// protect wraps the whole cloud surface:
//
//  1. security headers on every response;
//  2. Host check;
//  3. CORS with credentials, reflected only for configured origins (the
//     production frontend is same-origin and needs none; this is for a dev
//     server or a separately hosted frontend);
//  4. CSRF: a state-changing request whose Origin is not configured is
//     refused (SameSite=Lax cookies already keep them out of cross-site
//     POSTs; this also covers same-site, cross-origin pages). Requests
//     without Origin come from non-browser clients, unless Fetch Metadata
//     says the browser sent them cross-site;
//  5. a 1 MB cap on every non-upload API body (uploads are capped per
//     route in admit).
func (s *Service) protect(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("Referrer-Policy", "strict-origin-when-cross-origin")
		h.Set("X-Frame-Options", "DENY")

		if !s.allowedHost(r.Host) {
			writeError(w, http.StatusForbidden, "forbidden: unrecognized Host header")
			return
		}

		origin := strings.ToLower(r.Header.Get("Origin"))
		known := origin != "" && s.origins[origin]
		if known {
			h.Set("Access-Control-Allow-Origin", r.Header.Get("Origin"))
			h.Set("Access-Control-Allow-Credentials", "true")
			h.Add("Vary", "Origin")
			h.Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
			h.Set("Access-Control-Allow-Headers", "Content-Type")
		}
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if isWriteMethod(r.Method) {
			if origin != "" && !known {
				writeError(w, http.StatusForbidden, "forbidden: cross-origin write rejected")
				return
			}
			if origin == "" && r.Header.Get("Sec-Fetch-Site") == "cross-site" {
				writeError(w, http.StatusForbidden, "forbidden: cross-origin write rejected")
				return
			}
		}
		if strings.HasPrefix(r.URL.Path, "/api/") && !isMultipart(r) && r.Body != nil {
			r.Body = http.MaxBytesReader(w, r.Body, jsonBodyLimit)
		}
		next.ServeHTTP(w, r)
	})
}

func fromLoopback(r *http.Request) bool {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

// clientIP is the rate-limit key: the peer address, or with TrustProxy the
// address the local reverse proxy saw (the last X-Forwarded-For entry; a
// client can prepend fake entries but not change the last one).
func (s *Service) clientIP(r *http.Request) string {
	if s.cfg.TrustProxy && fromLoopback(r) {
		if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
			parts := strings.Split(xff, ",")
			if ip := strings.TrimSpace(parts[len(parts)-1]); ip != "" {
				return ip
			}
		}
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}
