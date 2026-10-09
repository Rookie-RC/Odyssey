package atlas

// Backup management: listing, restoring and deleting the automatic .atlas
// backups in <dataDir>/backups/ (PRODUCT_SPEC §32).
//
// Backups are addressed by bare file name only. Names arrive from the URL,
// so they are validated strictly before touching the filesystem: no path
// separators or parent references can ever reach filepath.Join, and the
// target must be an existing regular file directly inside backups/ (a
// symlink planted there is not followed).

import (
	"errors"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

var (
	// ErrInvalidBackupName: the name is not a plain "<name>.atlas" file name.
	ErrInvalidBackupName = errors.New("invalid backup name")
	// ErrBackupNotFound: no such backup file in the backups directory.
	ErrBackupNotFound = errors.New("backup not found")
)

// BackupInfo describes one backup file (GET /api/atlas/backups).
type BackupInfo struct {
	Name      string `json:"name"`
	Size      int64  `json:"size"`
	CreatedAt string `json:"createdAt"` // RFC 3339, from the file's modification time

	modTime time.Time
}

// BackupsDir returns <dataDir>/backups.
func BackupsDir(dataDir string) string { return filepath.Join(dataDir, "backups") }

// ValidBackupName reports whether name is acceptable as a backup file name:
// 1–200 bytes of ASCII letters, digits, '.', '-', '_', '+', '(', ')' and
// space; ending in ".atlas"; not starting with '.' or a space (hidden/temp
// files); and no "..". Spaces and parentheses are allowed so that copies made
// by a file manager ("backup (1).atlas", "backup - Copy.atlas") can still be
// managed; none of these characters can form a path.
func ValidBackupName(name string) bool {
	if len(name) == 0 || len(name) > 200 {
		return false
	}
	if !strings.HasSuffix(name, ".atlas") || len(name) == len(".atlas") {
		return false
	}
	if name[0] == '.' || name[0] == ' ' || strings.Contains(name, "..") {
		return false
	}
	for i := 0; i < len(name); i++ {
		c := name[i]
		switch {
		case c >= 'a' && c <= 'z', c >= 'A' && c <= 'Z', c >= '0' && c <= '9':
		case c == '.', c == '-', c == '_', c == '+', c == '(', c == ')', c == ' ':
		default:
			return false
		}
	}
	return filepath.Base(name) == name
}

// ListBackups returns the backups in <dataDir>/backups, newest first. Only
// regular files with a valid backup name are listed — exactly the ones
// BackupFile accepts — so every listed entry can be restored or deleted. A
// missing backups directory yields an empty list.
func ListBackups(dataDir string) ([]BackupInfo, error) {
	entries, err := os.ReadDir(BackupsDir(dataDir))
	if err != nil {
		if os.IsNotExist(err) {
			return []BackupInfo{}, nil
		}
		return nil, err
	}
	out := []BackupInfo{}
	for _, e := range entries {
		if !e.Type().IsRegular() || !ValidBackupName(e.Name()) {
			continue
		}
		info, err := e.Info()
		if err != nil {
			continue // vanished meanwhile
		}
		out = append(out, BackupInfo{
			Name:      e.Name(),
			Size:      info.Size(),
			CreatedAt: info.ModTime().Format(time.RFC3339),
			modTime:   info.ModTime(),
		})
	}
	sort.SliceStable(out, func(i, j int) bool {
		if !out[i].modTime.Equal(out[j].modTime) {
			return out[i].modTime.After(out[j].modTime)
		}
		return out[i].Name > out[j].Name
	})
	return out, nil
}

// BackupFile resolves a backup name to its absolute path. It returns
// ErrInvalidBackupName for a malformed name and ErrBackupNotFound unless the
// name is an existing regular file (not a directory or symlink) directly in
// the backups directory.
func BackupFile(dataDir, name string) (string, error) {
	if !ValidBackupName(name) {
		return "", ErrInvalidBackupName
	}
	p := filepath.Join(BackupsDir(dataDir), name)
	info, err := os.Lstat(p)
	if err != nil || !info.Mode().IsRegular() {
		return "", ErrBackupNotFound
	}
	return p, nil
}

// StageFile validates the .atlas package at path and extracts it to a
// staging directory under dataDir (see ValidateAndStage). The file is closed
// before returning, so the caller may go on to create or delete backups.
func StageFile(dataDir, path string) (*Staged, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		return nil, err
	}
	return ValidateAndStage(dataDir, info.Size(), f)
}

// DeleteBackup removes one backup file.
func DeleteBackup(dataDir, name string) error {
	p, err := BackupFile(dataDir, name)
	if err != nil {
		return err
	}
	if err := os.Remove(p); err != nil {
		if os.IsNotExist(err) {
			return ErrBackupNotFound
		}
		return err
	}
	return nil
}
