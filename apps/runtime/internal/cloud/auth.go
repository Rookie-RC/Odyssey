package cloud

import (
	"errors"
	"io"
	"log"
	"net/http"
	"os"
)

// Account endpoints:
//
//	POST   /api/auth/register  {email, password}             → 201 {user}   (+ session cookie)
//	POST   /api/auth/login     {email, password}             → 200 {user}   (+ session cookie)
//	POST   /api/auth/logout    {everywhere?: bool}           → 200 {ok}     (cookie cleared)
//	GET    /api/auth/me                                      → 200 {user, usage} | 401
//	POST   /api/auth/password  {currentPassword, newPassword} → 200 {user}  (other sessions signed out)
//	DELETE /api/auth/account   {password}                    → 200 {deleted} (account and Atlas removed)
//
// Bad credentials always get the same message, whether or not the email
// exists. Errors are {"error": "..."} like the rest of the API.

const badCredentials = "incorrect email or password"

type credentials struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

func (s *Service) handleRuntime(w http.ResponseWriter, r *http.Request) {
	u, ok := s.authenticate(w, r)
	resp := map[string]any{
		"mode":              "cloud",
		"writable":          ok,
		"authenticated":     ok,
		"allowSignup":       s.cfg.AllowSignup,
		"geocodingProvider": s.cfg.Geocoder.ProviderID(),
	}
	if ok {
		resp["user"] = u.Public()
	}
	writeJSON(w, http.StatusOK, resp)
}

func (s *Service) handleRegister(w http.ResponseWriter, r *http.Request) {
	if !s.cfg.AllowSignup {
		writeError(w, http.StatusForbidden, "sign-up is closed on this server")
		return
	}
	if ok, wait := s.signupIP.allow(s.clientIP(r)); !ok {
		tooMany(w, wait, "too many sign-ups from this network; try again later")
		return
	}
	var c credentials
	if err := decode(r, &c); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if _, err := NormalizeEmail(c.Email); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := validPassword(c.Password); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	u, err := s.users.Create(c.Email, c.Password)
	switch {
	case errors.Is(err, ErrEmailTaken):
		writeError(w, http.StatusConflict, err.Error())
		return
	case errors.Is(err, ErrInvalidEmail):
		writeError(w, http.StatusBadRequest, err.Error())
		return
	case err != nil:
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if _, ok := s.tenant(u.ID); !ok { // create the empty Atlas now
		writeError(w, http.StatusInternalServerError, "could not create your atlas")
		return
	}
	log.Printf("cloud: new account %s", u.ID)
	s.setSession(w, r, u)
	writeJSON(w, http.StatusCreated, map[string]any{"user": u.Public()})
}

func (s *Service) handleLogin(w http.ResponseWriter, r *http.Request) {
	if ok, wait := s.loginIP.allow(s.clientIP(r)); !ok {
		tooMany(w, wait, "too many sign-in attempts; try again later")
		return
	}
	var c credentials
	if err := decode(r, &c); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	email, _ := NormalizeEmail(c.Email)
	if email != "" {
		if ok, wait := s.loginEmail.allow(email); !ok {
			tooMany(w, wait, "too many sign-in attempts; try again later")
			return
		}
	}
	u, ok := s.users.Authenticate(c.Email, c.Password)
	if !ok {
		writeError(w, http.StatusUnauthorized, badCredentials)
		return
	}
	s.loginEmail.reset(email)
	s.setSession(w, r, u)
	writeJSON(w, http.StatusOK, map[string]any{"user": u.Public()})
}

func (s *Service) handleLogout(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Everywhere bool `json:"everywhere"`
	}
	if err := decode(r, &body); err != nil && !errors.Is(err, io.EOF) {
		writeError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if body.Everywhere {
		if u, ok := s.authenticate(w, r); ok {
			if _, err := s.users.BumpSessionVersion(u.ID); err != nil {
				writeError(w, http.StatusInternalServerError, err.Error())
				return
			}
		}
	}
	s.clearSession(w, r)
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Service) handleMe(w http.ResponseWriter, r *http.Request) {
	u, ok := s.authenticate(w, r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "sign in required")
		return
	}
	used, _ := dirSize(s.userDir(u.ID))
	writeJSON(w, http.StatusOK, map[string]any{
		"user":  u.Public(),
		"usage": map[string]int64{"bytes": used, "quotaBytes": s.cfg.QuotaBytes},
	})
}

// checkPassword re-verifies the signed-in user's password for sensitive
// actions, rate-limited like a login.
func (s *Service) checkPassword(w http.ResponseWriter, u User, password string) bool {
	if ok, wait := s.loginEmail.allow(u.Email); !ok {
		tooMany(w, wait, "too many attempts; try again later")
		return false
	}
	ok, err := VerifyPassword(u.PasswordHash, password)
	if err != nil || !ok {
		writeError(w, http.StatusForbidden, "incorrect password")
		return false
	}
	s.loginEmail.reset(u.Email)
	return true
}

func (s *Service) handlePassword(w http.ResponseWriter, r *http.Request) {
	u, ok := s.authenticate(w, r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "sign in required")
		return
	}
	var body struct {
		CurrentPassword string `json:"currentPassword"`
		NewPassword     string `json:"newPassword"`
	}
	if err := decode(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if err := validPassword(body.NewPassword); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if !s.checkPassword(w, u, body.CurrentPassword) {
		return
	}
	u, err := s.users.SetPassword(u.ID, body.NewPassword)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	s.setSession(w, r, u) // this browser stays signed in; others are not
	writeJSON(w, http.StatusOK, map[string]any{"user": u.Public()})
}

func (s *Service) handleDeleteAccount(w http.ResponseWriter, r *http.Request) {
	u, ok := s.authenticate(w, r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "sign in required")
		return
	}
	var body struct {
		Password string `json:"password"`
	}
	if err := decode(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if !s.checkPassword(w, u, body.Password) {
		return
	}
	if err := s.deleteUser(u.ID); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	log.Printf("cloud: deleted account %s", u.ID)
	s.clearSession(w, r)
	writeJSON(w, http.StatusOK, map[string]bool{"deleted": true})
}

// deleteUser removes the account and everything it owns: its Atlas
// directory (data, photos, backups) and its thumbnail cache. It waits for
// the user's in-flight requests; later ones find no account.
func (s *Service) deleteUser(id string) error {
	t, ok := s.tenant(id)
	if !ok {
		return ErrNoUser
	}
	t.mu.Lock()
	defer t.mu.Unlock()

	s.mu.Lock()
	err := s.users.Delete(id)
	if err == nil {
		delete(s.pool, id)
	}
	s.mu.Unlock()
	if err != nil {
		return err
	}
	t.deleted = true
	if err := os.RemoveAll(t.dir); err != nil {
		return err
	}
	return os.RemoveAll(t.thumbs)
}
