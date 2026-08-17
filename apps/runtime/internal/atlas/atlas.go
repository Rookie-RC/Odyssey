// Package atlas implements the portable Yu's Atlas package (.atlas), a
// ZIP-based container (PRODUCT_SPEC §30–33). The Go runtime owns packaging,
// validation, extraction, backup and replacement; the UI only triggers it.
//
// Package layout (inside the ZIP):
//
//	manifest.json        {"format":"yuatlas","schemaVersion":1,"appVersion":...,"exportedAt":...}
//	data/profile.json    portable structured data
//	data/places.json     ...
//	data/visits.json     ...
//	data/wishlist.json   ...
//	data/media.json      media metadata
//	data/settings.json   portable settings
//	media/<folder>/<file>  actual media files, organized by Place
//
// Machine-specific configuration (runtime-config.json), caches and temporary
// files are never packaged. Backups use the same container format and live in
// <dataDir>/backups/.
package atlas

import (
	"archive/zip"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/yuatlas/runtime/internal/domain"
)

const (
	Format        = "yuatlas"
	SchemaVersion = 1
	AppVersion    = "1.0.0"
)

// Known portable data files. Anything else under data/ is rejected on import.
var dataFiles = map[string]bool{
	"profile.json":  true,
	"places.json":   true,
	"visits.json":   true,
	"wishlist.json": true,
	"media.json":    true,
	"settings.json": true,
}

// defaultData writes the empty/blank content used for known files that are
// missing from an imported package, and for a brand-new Atlas.
func defaultData(name string) []byte {
	switch name {
	case "profile.json":
		b, _ := json.MarshalIndent(domain.Profile{}, "", "  ")
		return b
	case "settings.json":
		b, _ := json.MarshalIndent(domain.Settings{Theme: "light", GeocodingProvider: "photon"}, "", "  ")
		return b
	default:
		return []byte("[]\n")
	}
}

func newManifest() map[string]any {
	return map[string]any{
		"format":       Format,
		"schemaVersion": SchemaVersion,
		"appVersion":   AppVersion,
		"exportedAt":   time.Now().Format(time.RFC3339),
	}
}

// --- Export ---

// Export writes a full package (manifest + data + media) to w.
func Export(dataDir string, w io.Writer) error {
	zw := zip.NewWriter(w)
	if err := addJSONEntry(zw, "manifest.json", newManifest()); err != nil {
		return err
	}

	dataDirPath := filepath.Join(dataDir, "data")
	if err := addDirJSONEntries(zw, dataDirPath, "data"); err != nil {
		return err
	}

	mediaRoot := filepath.Join(dataDir, "media")
	if err := addTreeEntries(zw, mediaRoot, "media"); err != nil {
		return err
	}

	return zw.Close()
}

func addJSONEntry(zw *zip.Writer, name string, v any) error {
	b, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return err
	}
	return addBytesEntry(zw, name, append(b, '\n'))
}

func addBytesEntry(zw *zip.Writer, name string, b []byte) error {
	f, err := zw.Create(name)
	if err != nil {
		return err
	}
	_, err = f.Write(b)
	return err
}

func addDirJSONEntries(zw *zip.Writer, dir, prefix string) error {
	entries, err := os.ReadDir(dir)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	for _, e := range entries {
		if e.IsDir() || !dataFiles[e.Name()] {
			continue
		}
		b, err := os.ReadFile(filepath.Join(dir, e.Name()))
		if err != nil {
			return err
		}
		if err := addBytesEntry(zw, prefix+"/"+e.Name(), b); err != nil {
			return err
		}
	}
	return nil
}

func addTreeEntries(zw *zip.Writer, root, prefix string) error {
	return filepath.WalkDir(root, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			if os.IsNotExist(err) {
				return nil
			}
			return err
		}
		if d.IsDir() {
			return nil
		}
		rel, err := filepath.Rel(root, p)
		if err != nil {
			return err
		}
		f, err := zw.Create(prefix + "/" + filepath.ToSlash(rel))
		if err != nil {
			return err
		}
		rc, err := os.Open(p)
		if err != nil {
			return err
		}
		defer rc.Close()
		_, err = io.Copy(f, rc)
		return err
	})
}

// Backup writes the current Atlas (same package format) into
// <dataDir>/backups/backup-<timestamp>.atlas and returns the relative path.
func Backup(dataDir string) (string, error) {
	backupDir := filepath.Join(dataDir, "backups")
	if err := os.MkdirAll(backupDir, 0o755); err != nil {
		return "", err
	}
	name := "backup-" + time.Now().Format("20060102-150405") + ".atlas"
	p := filepath.Join(backupDir, name)
	f, err := os.Create(p)
	if err != nil {
		return "", err
	}
	defer f.Close()
	if err := Export(dataDir, f); err != nil {
		_ = os.Remove(p)
		return "", err
	}
	return filepath.Join("backups", name), nil
}

// --- Import ---

// Manifest is the validated package manifest.
type Manifest struct {
	Format       string `json:"format"`
	SchemaVersion int    `json:"schemaVersion"`
	AppVersion   string `json:"appVersion"`
	ExportedAt   string `json:"exportedAt"`
}

// Staged is a fully validated package extracted to a staging directory,
// ready to replace the current Atlas.
type Staged struct {
	Manifest      Manifest
	DataFiles     map[string][]byte
	MediaFiles    []string // relative media paths ("folder/file")
	StagingDir    string
	MediaRoot     string // extracted media dir inside staging
	dataDir       string
}

// cleanEntry normalizes a zip entry name and rejects path traversal
// (zip-slip) and absolute paths.
func cleanEntry(name string) (string, bool) {
	name = strings.ReplaceAll(name, "\\", "/")
	name = strings.TrimPrefix(name, "./")
	if name == "" || strings.HasPrefix(name, "/") {
		return "", false
	}
	clean := path.Clean(name)
	if clean == "." || clean == ".." || strings.HasPrefix(clean, "../") || strings.Contains(clean, "/../") {
		return "", false
	}
	if clean != name && clean != strings.TrimSuffix(name, "/") {
		return "", false
	}
	return clean, true
}

// benignEntry reports platform-generated junk that is skipped silently.
func benignEntry(name string) bool {
	base := path.Base(name)
	return base == ".DS_Store" || base == "Thumbs.db" ||
		strings.HasPrefix(name, "__MACOSX/") || name == "__MACOSX"
}

// ValidateAndStage opens, validates and extracts a package into a staging
// directory under dataDir. On any error the staging directory is removed and
// the current Atlas is untouched.
func ValidateAndStage(dataDir string, size int64, r io.ReaderAt) (*Staged, error) {
	zr, err := zip.NewReader(r, size)
	if err != nil {
		return nil, fmt.Errorf("not a valid .atlas archive: %w", err)
	}

	staging := filepath.Join(dataDir, ".atlas-import-"+randSuffix())
	mediaRoot := filepath.Join(staging, "media")
	if err := os.MkdirAll(mediaRoot, 0o755); err != nil {
		return nil, err
	}

	st := &Staged{
		DataFiles:  map[string][]byte{},
		MediaFiles: []string{},
		StagingDir: staging,
		MediaRoot:  mediaRoot,
		dataDir:    dataDir,
	}

	cleanup := func() {
		_ = os.RemoveAll(staging)
	}

	seenManifest := false
	for _, f := range zr.File {
		name, ok := cleanEntry(f.Name)
		if !ok {
			cleanup()
			return nil, fmt.Errorf("package contains an unsafe path %q", f.Name)
		}
		if f.FileInfo().IsDir() {
			continue
		}
		if benignEntry(name) {
			continue
		}

		switch {
		case name == "manifest.json":
			b, err := readZipEntry(f)
			if err != nil {
				cleanup()
				return nil, err
			}
			var m Manifest
			if err := json.Unmarshal(b, &m); err != nil {
				cleanup()
				return nil, errors.New("invalid manifest.json in package")
			}
			if m.Format != Format {
				cleanup()
				return nil, fmt.Errorf("unsupported package format %q (expected %q)", m.Format, Format)
			}
			if m.SchemaVersion > SchemaVersion {
				cleanup()
				return nil, fmt.Errorf("package uses schema version %d, this build supports up to %d", m.SchemaVersion, SchemaVersion)
			}
			if m.SchemaVersion < 1 {
				cleanup()
				return nil, fmt.Errorf("package has an invalid schemaVersion %d", m.SchemaVersion)
			}
			st.Manifest = m
			seenManifest = true

		case strings.HasPrefix(name, "data/"):
			rel := strings.TrimPrefix(name, "data/")
			if !dataFiles[rel] {
				cleanup()
				return nil, fmt.Errorf("package contains an unexpected data file %q", name)
			}
			b, err := readZipEntry(f)
			if err != nil {
				cleanup()
				return nil, err
			}
			if err := validateDataJSON(rel, b); err != nil {
				cleanup()
				return nil, fmt.Errorf("invalid %s in package: %w", rel, err)
			}
			st.DataFiles[rel] = b

		case strings.HasPrefix(name, "media/"):
			rel := strings.TrimPrefix(name, "media/")
			if rel == "" || strings.HasSuffix(rel, "/") {
				continue
			}
			if err := extractZipEntry(f, filepath.Join(mediaRoot, filepath.FromSlash(rel))); err != nil {
				cleanup()
				return nil, err
			}
			st.MediaFiles = append(st.MediaFiles, rel)

		default:
			cleanup()
			return nil, fmt.Errorf("package contains an unexpected path %q", name)
		}
	}

	if !seenManifest {
		cleanup()
		return nil, errors.New("package is missing manifest.json")
	}

	// Fill known-but-missing data files with blank defaults so the imported
	// Atlas is always a complete, consistent state.
	for name := range dataFiles {
		if _, ok := st.DataFiles[name]; !ok {
			st.DataFiles[name] = defaultData(name)
		}
	}

	sort.Strings(st.MediaFiles)
	return st, nil
}

func readZipEntry(f *zip.File) ([]byte, error) {
	rc, err := f.Open()
	if err != nil {
		return nil, err
	}
	defer rc.Close()
	return io.ReadAll(io.LimitReader(rc, 512<<20))
}

func extractZipEntry(f *zip.File, dst string) error {
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return err
	}
	rc, err := f.Open()
	if err != nil {
		return err
	}
	defer rc.Close()
	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer out.Close()
	if _, err := io.Copy(out, io.LimitReader(rc, 512<<20)); err != nil {
		return err
	}
	return nil
}

// validateDataJSON performs light structural validation so a corrupt package
// is rejected before anything is replaced.
func validateDataJSON(name string, b []byte) error {
	var v any
	if err := json.Unmarshal(b, &v); err != nil {
		return fmt.Errorf("not valid JSON: %w", err)
	}
	switch name {
	case "places.json", "visits.json", "wishlist.json", "media.json":
		if _, ok := v.([]any); !ok {
			return errors.New("expected a JSON array")
		}
	case "profile.json", "settings.json":
		if _, ok := v.(map[string]any); !ok {
			return errors.New("expected a JSON object")
		}
	}
	return nil
}

// Replace swaps the current Atlas for the staged one. A backup is created
// first. If the swap fails partway, the previous data/media are restored
// where possible (the backup in backups/ is the guaranteed recovery point).
func (st *Staged) Replace() (string, error) {
	backupRel, err := Backup(st.dataDir)
	if err != nil {
		return "", fmt.Errorf("backup failed, import aborted: %w", err)
	}

	// Data files: write the staged content over each known file.
	dataDirPath := filepath.Join(st.dataDir, "data")
	if err := os.MkdirAll(dataDirPath, 0o755); err != nil {
		return backupRel, err
	}
	for name, content := range st.DataFiles {
		p := filepath.Join(dataDirPath, name)
		if err := writeFileAtomic(p, content); err != nil {
			return backupRel, fmt.Errorf("replacing %s failed: %w", name, err)
		}
	}

	// Media: swap the whole directory (rename old aside, move staged in,
	// then delete the old tree).
	mediaDir := filepath.Join(st.dataDir, "media")
	oldMedia := mediaDir + ".old-" + randSuffix()
	hadOld := false
	if _, err := os.Stat(mediaDir); err == nil {
		if err := os.Rename(mediaDir, oldMedia); err != nil {
			return backupRel, err
		}
		hadOld = true
	}
	if err := os.Rename(st.MediaRoot, mediaDir); err != nil {
		// Restore the previous media tree before failing.
		if hadOld {
			_ = os.Rename(oldMedia, mediaDir)
		}
		return backupRel, fmt.Errorf("replacing media failed: %w", err)
	}
	if hadOld {
		_ = os.RemoveAll(oldMedia)
	}
	return backupRel, nil
}

// Cleanup removes the staging directory after a successful replace.
func (st *Staged) Cleanup() {
	_ = os.RemoveAll(st.StagingDir)
}

func writeFileAtomic(p string, content []byte) error {
	tmp := p + ".tmp"
	if err := os.WriteFile(tmp, content, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, p)
}

// NewAtlas replaces the current Atlas with a minimal blank one. A backup is
// created first; the theme preference is kept so a new Atlas still starts in
// the user's preferred appearance.
func NewAtlas(dataDir string, keepTheme string) (string, error) {
	backupRel, err := Backup(dataDir)
	if err != nil {
		return "", fmt.Errorf("backup failed, new-atlas aborted: %w", err)
	}
	settings := domain.Settings{Theme: "light", GeocodingProvider: "photon"}
	if keepTheme == "night" {
		settings.Theme = "night"
	}
	files := map[string]any{
		"profile.json":  domain.Profile{},
		"places.json":   []domain.Place{},
		"visits.json":   []domain.Visit{},
		"wishlist.json": []domain.Wishlist{},
		"media.json":    []domain.Media{},
		"settings.json": settings,
	}
	dataDirPath := filepath.Join(dataDir, "data")
	if err := os.MkdirAll(dataDirPath, 0o755); err != nil {
		return backupRel, err
	}
	for name, v := range files {
		b, err := json.MarshalIndent(v, "", "  ")
		if err != nil {
			return backupRel, err
		}
		if err := writeFileAtomic(filepath.Join(dataDirPath, name), append(b, '\n')); err != nil {
			return backupRel, err
		}
	}
	mediaDir := filepath.Join(dataDir, "media")
	if err := os.RemoveAll(mediaDir); err != nil {
		return backupRel, err
	}
	return backupRel, nil
}

func randSuffix() string {
	var b [6]byte
	if _, err := rand.Read(b[:]); err != nil {
		return fmt.Sprintf("%d", time.Now().UnixNano())
	}
	return fmt.Sprintf("%x", b[:])
}
