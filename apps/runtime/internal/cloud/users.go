package cloud

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/mail"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// User is one account. Its Atlas lives in <root>/users/<ID>/, a complete
// atlas-data directory exactly like the local runtime's.
type User struct {
	ID           string    `json:"id"`
	Email        string    `json:"email"`
	PasswordHash string    `json:"passwordHash"`
	CreatedAt    time.Time `json:"createdAt"`
	// SessionVersion is embedded in every session cookie; bumping it (sign
	// out everywhere, password change) invalidates all existing sessions.
	SessionVersion int `json:"sessionVersion"`
}

// PublicUser is what the API reveals about the signed-in user.
type PublicUser struct {
	ID    string `json:"id"`
	Email string `json:"email"`
}

func (u User) Public() PublicUser { return PublicUser{ID: u.ID, Email: u.Email} }

var (
	ErrEmailTaken   = errors.New("an account with this email already exists")
	ErrInvalidEmail = errors.New("enter a valid email address")
	ErrNoUser       = errors.New("user not found")
)

// UserStore keeps every account in <root>/users.json (mode 0600), loaded
// once and rewritten atomically on each change. Plenty for the expected
// scale (hundreds to a few thousand accounts); swap for a database behind
// the same methods when that stops being true.
type UserStore struct {
	mu    sync.RWMutex
	path  string
	users map[string]User // by ID
}

func OpenUserStore(root string) (*UserStore, error) {
	s := &UserStore{path: filepath.Join(root, "users.json"), users: map[string]User{}}
	b, err := os.ReadFile(s.path)
	if errors.Is(err, os.ErrNotExist) {
		return s, nil
	}
	if err != nil {
		return nil, err
	}
	var list []User
	if len(b) > 0 {
		if err := json.Unmarshal(b, &list); err != nil {
			return nil, err
		}
	}
	for _, u := range list {
		s.users[u.ID] = u
	}
	return s, nil
}

// saveLocked writes the store; the caller holds mu for writing.
func (s *UserStore) saveLocked() error {
	list := make([]User, 0, len(s.users))
	for _, u := range s.users {
		list = append(list, u)
	}
	b, err := json.MarshalIndent(list, "", "  ")
	if err != nil {
		return err
	}
	tmp := s.path + ".tmp"
	if err := os.WriteFile(tmp, b, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, s.path)
}

// NormalizeEmail trims and lowercases an address and rejects anything that
// is not a bare addr-spec (no display names, no angle brackets).
func NormalizeEmail(raw string) (string, error) {
	e := strings.ToLower(strings.TrimSpace(raw))
	if e == "" || len(e) > 254 {
		return "", ErrInvalidEmail
	}
	a, err := mail.ParseAddress(e)
	if err != nil || a.Address != e || a.Name != "" {
		return "", ErrInvalidEmail
	}
	at := strings.LastIndexByte(e, '@')
	if at < 1 || !strings.Contains(e[at+1:], ".") {
		return "", ErrInvalidEmail
	}
	return e, nil
}

func newUserID() (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

// Create adds an account. The password must already be validated.
func (s *UserStore) Create(email, password string) (User, error) {
	email, err := NormalizeEmail(email)
	if err != nil {
		return User{}, err
	}
	if _, ok := s.ByEmail(email); ok {
		return User{}, ErrEmailTaken
	}
	hash, err := HashPassword(password) // slow: outside the lock
	if err != nil {
		return User{}, err
	}
	id, err := newUserID()
	if err != nil {
		return User{}, err
	}
	u := User{ID: id, Email: email, PasswordHash: hash, CreatedAt: time.Now().UTC().Truncate(time.Second), SessionVersion: 1}

	s.mu.Lock()
	defer s.mu.Unlock()
	for _, other := range s.users { // re-check: another request may have won
		if other.Email == email {
			return User{}, ErrEmailTaken
		}
	}
	s.users[id] = u
	if err := s.saveLocked(); err != nil {
		delete(s.users, id)
		return User{}, err
	}
	return u, nil
}

func (s *UserStore) Get(id string) (User, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	u, ok := s.users[id]
	return u, ok
}

func (s *UserStore) ByEmail(email string) (User, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, u := range s.users {
		if u.Email == email {
			return u, true
		}
	}
	return User{}, false
}

// Authenticate returns the account for email when password matches. Unknown
// emails cost the same argon2 work as wrong passwords.
func (s *UserStore) Authenticate(email, password string) (User, bool) {
	email, err := NormalizeEmail(email)
	u, found := s.ByEmail(email)
	if err != nil || !found {
		_, _ = VerifyPassword(dummyHash(), password)
		return User{}, false
	}
	ok, err := VerifyPassword(u.PasswordHash, password)
	if err != nil || !ok {
		return User{}, false
	}
	return u, true
}

// update applies fn to the stored user and persists the result.
func (s *UserStore) update(id string, fn func(*User)) (User, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	u, ok := s.users[id]
	if !ok {
		return User{}, ErrNoUser
	}
	prev := u
	fn(&u)
	s.users[id] = u
	if err := s.saveLocked(); err != nil {
		s.users[id] = prev
		return User{}, err
	}
	return u, nil
}

// BumpSessionVersion signs the user out everywhere.
func (s *UserStore) BumpSessionVersion(id string) (User, error) {
	return s.update(id, func(u *User) { u.SessionVersion++ })
}

// SetPassword replaces the password hash and signs out every session.
func (s *UserStore) SetPassword(id, password string) (User, error) {
	hash, err := HashPassword(password)
	if err != nil {
		return User{}, err
	}
	return s.update(id, func(u *User) {
		u.PasswordHash = hash
		u.SessionVersion++
	})
}

// Delete removes the account record (not its data; see Service).
func (s *UserStore) Delete(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	u, ok := s.users[id]
	if !ok {
		return ErrNoUser
	}
	delete(s.users, id)
	if err := s.saveLocked(); err != nil {
		s.users[id] = u
		return err
	}
	return nil
}

func (s *UserStore) Count() int {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return len(s.users)
}
