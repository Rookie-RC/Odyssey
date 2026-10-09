package atlas

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestValidBackupName(t *testing.T) {
	for name, want := range map[string]bool{
		"backup-20260816-225500.atlas":   true,
		"backup-20260816-225500-2.atlas": true,
		"yu-atlas-20260101-120000.atlas": true,
		"backup (1).atlas":               true,
		"backup - Copy.atlas":            true,
		"":                               false,
		".atlas":                         false,
		".hidden.atlas":                  false,
		" leading.atlas":                 false,
		"backup.zip":                     false,
		"backup.ATLAS":                   false,
		"backup.atlas.tmp":               false,
		"../backup.atlas":                false,
		"..":                             false,
		"a..b.atlas":                     false,
		"sub/backup.atlas":               false,
		`sub\backup.atlas`:               false,
		"C:backup.atlas":                 false,
		"back\x00up.atlas":               false,
		"backup\n.atlas":                 false,
		"bäckup.atlas":                   false,
	} {
		if got := ValidBackupName(name); got != want {
			t.Errorf("ValidBackupName(%q) = %v, want %v", name, got, want)
		}
	}
}

func TestListAndDeleteBackups(t *testing.T) {
	dir := t.TempDir()
	if list, err := ListBackups(dir); err != nil || list == nil || len(list) != 0 {
		t.Fatalf("no backups dir: %v, %v", list, err)
	}

	bdir := BackupsDir(dir)
	if err := os.MkdirAll(filepath.Join(bdir, "folder.atlas"), 0o755); err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	for i, name := range []string{"old.atlas", "new.atlas", "mid.atlas", ".partial.atlas", "notes.txt"} {
		p := filepath.Join(bdir, name)
		if err := os.WriteFile(p, make([]byte, 10*(i+1)), 0o644); err != nil {
			t.Fatal(err)
		}
		age := map[string]time.Duration{"old.atlas": 3 * time.Hour, "mid.atlas": 2 * time.Hour, "new.atlas": time.Hour}[name]
		if err := os.Chtimes(p, now.Add(-age), now.Add(-age)); err != nil {
			t.Fatal(err)
		}
	}

	list, err := ListBackups(dir)
	if err != nil {
		t.Fatal(err)
	}
	var names []string
	for _, b := range list {
		names = append(names, b.Name)
		if _, err := time.Parse(time.RFC3339, b.CreatedAt); err != nil {
			t.Errorf("%s createdAt %q not RFC 3339", b.Name, b.CreatedAt)
		}
	}
	if len(names) != 3 || names[0] != "new.atlas" || names[1] != "mid.atlas" || names[2] != "old.atlas" {
		t.Fatalf("list = %v, want [new mid old] (dirs, hidden and non-.atlas files excluded)", names)
	}
	if list[0].Size != 20 {
		t.Errorf("size = %d, want 20", list[0].Size)
	}

	if err := DeleteBackup(dir, "mid.atlas"); err != nil {
		t.Fatal(err)
	}
	if err := DeleteBackup(dir, "mid.atlas"); !errors.Is(err, ErrBackupNotFound) {
		t.Errorf("second delete: %v", err)
	}
	if err := DeleteBackup(dir, "folder.atlas"); !errors.Is(err, ErrBackupNotFound) {
		t.Errorf("deleting a directory: %v", err)
	}
	if err := DeleteBackup(dir, "../data.atlas"); !errors.Is(err, ErrInvalidBackupName) {
		t.Errorf("traversal: %v", err)
	}
}

// TestBackupFileRejectsSymlinks: a symlink in backups/ pointing elsewhere is
// not a backup.
func TestBackupFileRejectsSymlinks(t *testing.T) {
	dir := t.TempDir()
	outside := filepath.Join(dir, "outside.atlas")
	if err := os.WriteFile(outside, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(BackupsDir(dir), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(BackupsDir(dir), "link.atlas")); err != nil {
		t.Skipf("symlinks unavailable: %v", err)
	}
	if _, err := BackupFile(dir, "link.atlas"); !errors.Is(err, ErrBackupNotFound) {
		t.Errorf("symlink accepted: %v", err)
	}
	if list, _ := ListBackups(dir); len(list) != 0 {
		t.Errorf("symlink listed: %+v", list)
	}
}
