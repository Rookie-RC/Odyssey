package cloud

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// Sessions are stateless: the cookie carries {user id, session version,
// expiry}, signed with HMAC-SHA256. Nothing is stored server-side; a session
// is revoked by bumping the user's SessionVersion (or deleting the user),
// which every request checks against the user store.
const (
	sessionCookie = "atlas_session"
	sessionTTL    = 30 * 24 * time.Hour
	// Sessions with less than this left are re-issued on use, so an active
	// user stays signed in.
	sessionRenewBelow = 15 * 24 * time.Hour
)

var (
	errBadSession     = errors.New("invalid session")
	errExpiredSession = errors.New("session expired")
)

type sessionClaims struct {
	UID     string `json:"u"`
	Version int    `json:"v"`
	Expires int64  `json:"e"` // unix seconds
}

type Sessions struct {
	secret []byte
	now    func() time.Time
}

func NewSessions(secret []byte) *Sessions {
	return &Sessions{secret: secret, now: time.Now}
}

func (s *Sessions) mac(payload string) []byte {
	m := hmac.New(sha256.New, s.secret)
	m.Write([]byte("atlas-session-v1."))
	m.Write([]byte(payload))
	return m.Sum(nil)
}

// Issue returns a signed cookie value and its expiry.
func (s *Sessions) Issue(uid string, version int) (string, time.Time) {
	exp := s.now().Add(sessionTTL).Truncate(time.Second)
	b, _ := json.Marshal(sessionClaims{UID: uid, Version: version, Expires: exp.Unix()})
	payload := base64.RawURLEncoding.EncodeToString(b)
	return payload + "." + base64.RawURLEncoding.EncodeToString(s.mac(payload)), exp
}

// Parse verifies a cookie value's signature and expiry.
func (s *Sessions) Parse(value string) (sessionClaims, error) {
	payload, sig, ok := strings.Cut(value, ".")
	if !ok || payload == "" || sig == "" {
		return sessionClaims{}, errBadSession
	}
	got, err := base64.RawURLEncoding.DecodeString(sig)
	if err != nil || !hmac.Equal(got, s.mac(payload)) {
		return sessionClaims{}, errBadSession
	}
	raw, err := base64.RawURLEncoding.DecodeString(payload)
	if err != nil {
		return sessionClaims{}, errBadSession
	}
	var c sessionClaims
	if err := json.Unmarshal(raw, &c); err != nil || c.UID == "" {
		return sessionClaims{}, errBadSession
	}
	if !s.now().Before(time.Unix(c.Expires, 0)) {
		return sessionClaims{}, errExpiredSession
	}
	return c, nil
}

// LoadSecret returns the session signing key: ATLAS_SESSION_SECRET when set
// (at least 32 characters), otherwise <root>/secret.key, created with 32
// random bytes (mode 0600) on first start. Rotating it signs everyone out.
func LoadSecret(root string) ([]byte, error) {
	if env := os.Getenv("ATLAS_SESSION_SECRET"); env != "" {
		if len(env) < 32 {
			return nil, errors.New("ATLAS_SESSION_SECRET must be at least 32 characters")
		}
		return []byte(env), nil
	}
	p := filepath.Join(root, "secret.key")
	if b, err := os.ReadFile(p); err == nil {
		key, err := hex.DecodeString(strings.TrimSpace(string(b)))
		if err != nil || len(key) < 32 {
			return nil, fmt.Errorf("%s is not a valid key (64 hex characters expected)", p)
		}
		return key, nil
	} else if !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}
	key := make([]byte, 32)
	if _, err := rand.Read(key); err != nil {
		return nil, err
	}
	f, err := os.OpenFile(p, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return nil, err
	}
	if _, err := f.WriteString(hex.EncodeToString(key) + "\n"); err != nil {
		f.Close()
		return nil, err
	}
	return key, f.Close()
}
