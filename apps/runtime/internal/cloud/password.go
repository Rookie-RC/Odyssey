package cloud

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"
	"sync"

	"golang.org/x/crypto/argon2"
)

// Password hashing: argon2id (RFC 9106) in the PHC string format
//
//	$argon2id$v=19$m=19456,t=2,p=1$<salt>$<hash>
//
// with the OWASP minimum parameters (19 MiB, 2 passes, 1 lane). The
// parameters live in the string, so they can be raised later without
// invalidating stored hashes: verification always uses the stored ones.
const (
	argonMemory  = 19 * 1024 // KiB
	argonTime    = 2
	argonThreads = 1
	argonKeyLen  = 32
	saltLen      = 16

	minPasswordLen = 8
	// maxPasswordLen bounds the work an attacker can make us do per request.
	maxPasswordLen = 512
)

var errMalformedHash = errors.New("malformed password hash")

// hashSlots caps concurrent argon2 runs (each allocates argonMemory), so a
// burst of logins cannot exhaust a small server's memory.
var hashSlots = make(chan struct{}, 2)

func argon(password, salt []byte, t, m uint32, p uint8, keyLen uint32) []byte {
	hashSlots <- struct{}{}
	defer func() { <-hashSlots }()
	return argon2.IDKey(password, salt, t, m, p, keyLen)
}

// HashPassword returns the encoded argon2id hash of password.
func HashPassword(password string) (string, error) {
	salt := make([]byte, saltLen)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	key := argon([]byte(password), salt, argonTime, argonMemory, argonThreads, argonKeyLen)
	b64 := base64.RawStdEncoding
	return fmt.Sprintf("$argon2id$v=%d$m=%d,t=%d,p=%d$%s$%s",
		argon2.Version, argonMemory, argonTime, argonThreads, b64.EncodeToString(salt), b64.EncodeToString(key)), nil
}

// VerifyPassword reports whether password matches encoded (constant time).
func VerifyPassword(encoded, password string) (bool, error) {
	parts := strings.Split(encoded, "$")
	// "", "argon2id", "v=19", "m=…,t=…,p=…", salt, hash
	if len(parts) != 6 || parts[0] != "" || parts[1] != "argon2id" {
		return false, errMalformedHash
	}
	var version int
	if _, err := fmt.Sscanf(parts[2], "v=%d", &version); err != nil || version != argon2.Version {
		return false, errMalformedHash
	}
	var m, t uint32
	var p uint8
	if _, err := fmt.Sscanf(parts[3], "m=%d,t=%d,p=%d", &m, &t, &p); err != nil || m == 0 || t == 0 || p == 0 {
		return false, errMalformedHash
	}
	b64 := base64.RawStdEncoding
	salt, err := b64.DecodeString(parts[4])
	if err != nil {
		return false, errMalformedHash
	}
	want, err := b64.DecodeString(parts[5])
	if err != nil || len(want) == 0 {
		return false, errMalformedHash
	}
	got := argon([]byte(password), salt, t, m, p, uint32(len(want)))
	return subtle.ConstantTimeCompare(got, want) == 1, nil
}

// dummyHash is verified against when an email is unknown, so a failed
// login takes the same time whether or not the account exists. Computed on
// first use, so local mode (which never logs in) never pays for it.
var dummyHash = sync.OnceValue(func() string {
	h, err := HashPassword("not-a-real-password")
	if err != nil {
		panic(err)
	}
	return h
})

func validPassword(pw string) error {
	if len(pw) < minPasswordLen {
		return fmt.Errorf("password must be at least %d characters", minPasswordLen)
	}
	if len(pw) > maxPasswordLen {
		return fmt.Errorf("password must be at most %d characters", maxPasswordLen)
	}
	return nil
}
