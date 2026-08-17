package atlas

import (
	"archive/zip"
	"bytes"
	"os"
	"path/filepath"
	"testing"
)

// helper: build a minimal atlas-data tree with data + media.
func buildFixture(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	write := func(rel, content string) {
		p := filepath.Join(dir, rel)
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	write("data/profile.json", `{"name":"Yu"}`)
	write("data/places.json", `[{"id":"p1","name":"Bordeaux","country":"France","countryCode":"FR","type":"city","coordinates":{"lat":44.8,"lng":-0.6}}]`)
	write("data/visits.json", `[]`)
	write("data/wishlist.json", `[]`)
	write("data/media.json", `[{"id":"m1","type":"image","source":"local","path":"/media/bordeaux/photo.jpg"}]`)
	write("data/settings.json", `{"theme":"light"}`)
	write("media/bordeaux/photo.jpg", "fake-jpeg-bytes")
	return dir
}

// TestExportProducesPackage verifies the exported zip contains manifest, data
// and media at the expected paths, and no runtime-config.
func TestExportProducesPackage(t *testing.T) {
	dir := buildFixture(t)
	write := func(rel, content string) {
		if err := os.WriteFile(filepath.Join(dir, rel), []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	write("runtime-config.json", `{"geocodingProvider":"photon","mapTilerApiKey":"secret"}`)

	var buf bytes.Buffer
	if err := Export(dir, &buf); err != nil {
		t.Fatalf("export: %v", err)
	}
	zr, err := zip.NewReader(bytes.NewReader(buf.Bytes()), int64(buf.Len()))
	if err != nil {
		t.Fatalf("not a zip: %v", err)
	}
	names := map[string]bool{}
	for _, f := range zr.File {
		names[f.Name] = true
	}
	for _, want := range []string{
		"manifest.json",
		"data/profile.json",
		"data/places.json",
		"data/visits.json",
		"data/wishlist.json",
		"data/media.json",
		"data/settings.json",
		"media/bordeaux/photo.jpg",
	} {
		if !names[want] {
			t.Errorf("export missing %q", want)
		}
	}
	for _, bad := range []string{"runtime-config.json", "data/runtime-config.json"} {
		if names[bad] {
			t.Errorf("export leaked machine config %q", bad)
		}
	}
}

// TestImportRoundTrip exports a fixture, stages it, replaces into a fresh
// data dir, and verifies the content came back.
func TestImportRoundTrip(t *testing.T) {
	src := buildFixture(t)
	var buf bytes.Buffer
	if err := Export(src, &buf); err != nil {
		t.Fatalf("export: %v", err)
	}

	dst := t.TempDir()
	st, err := ValidateAndStage(dst, int64(buf.Len()), bytes.NewReader(buf.Bytes()))
	if err != nil {
		t.Fatalf("validate/stage: %v", err)
	}
	defer st.Cleanup()
	if _, err := st.Replace(); err != nil {
		t.Fatalf("replace: %v", err)
	}

	got, err := os.ReadFile(filepath.Join(dst, "data", "places.json"))
	if err != nil {
		t.Fatal(err)
	}
	want, _ := os.ReadFile(filepath.Join(src, "data", "places.json"))
	if string(got) != string(want) {
		t.Errorf("places.json mismatch:\n got %s\nwant %s", got, want)
	}
	img, err := os.ReadFile(filepath.Join(dst, "media", "bordeaux", "photo.jpg"))
	if err != nil || string(img) != "fake-jpeg-bytes" {
		t.Errorf("media not restored: %v", err)
	}
	if _, err := os.Stat(filepath.Join(dst, "backups")); err != nil {
		t.Errorf("backup directory not created: %v", err)
	}
}

// TestMissingDataFilesGetDefaults: a package without visits.json still yields
// a complete data directory.
func TestMissingDataFilesGetDefaults(t *testing.T) {
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	if err := addJSONEntry(zw, "manifest.json", newManifest()); err != nil {
		t.Fatal(err)
	}
	if err := addBytesEntry(zw, "data/places.json", []byte(`[{"id":"p1","name":"X","country":"Y","countryCode":"YY","type":"city","coordinates":{"lat":0,"lng":0}}]`)); err != nil {
		t.Fatal(err)
	}
	zw.Close()

	dst := t.TempDir()
	st, err := ValidateAndStage(dst, int64(buf.Len()), bytes.NewReader(buf.Bytes()))
	if err != nil {
		t.Fatalf("validate: %v", err)
	}
	defer st.Cleanup()
	if _, err := st.Replace(); err != nil {
		t.Fatal(err)
	}
	for _, f := range []string{"visits.json", "wishlist.json", "media.json"} {
		b, err := os.ReadFile(filepath.Join(dst, "data", f))
		if err != nil {
			t.Fatalf("%s missing: %v", f, err)
		}
		if string(bytes.TrimSpace(b)) != "[]" {
			t.Errorf("%s not defaulted: %s", f, b)
		}
	}
}

// TestZipSlipRejected: traversal entries must be rejected and nothing written
// outside the data dir.
func TestZipSlipRejected(t *testing.T) {
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	if err := addJSONEntry(zw, "manifest.json", newManifest()); err != nil {
		t.Fatal(err)
	}
	if err := addBytesEntry(zw, "../evil.txt", []byte("pwned")); err != nil {
		t.Fatal(err)
	}
	zw.Close()

	dst := t.TempDir()
	_, err := ValidateAndStage(dst, int64(buf.Len()), bytes.NewReader(buf.Bytes()))
	if err == nil {
		t.Fatal("expected traversal to be rejected")
	}
	if _, statErr := os.Stat(filepath.Join(filepath.Dir(dst), "evil.txt")); statErr == nil {
		t.Fatal("traversal wrote a file outside the data dir")
	}
	if entries, _ := os.ReadDir(dst); len(entries) != 0 {
		t.Errorf("staging dir not cleaned up: %v", entries)
	}
}

// TestBadManifestRejected: missing/invalid manifest and unknown data files are
// rejected cleanly.
func TestBadManifestRejected(t *testing.T) {
	build := func(add func(zw *zip.Writer)) []byte {
		var buf bytes.Buffer
		zw := zip.NewWriter(&buf)
		add(zw)
		zw.Close()
		return buf.Bytes()
	}
	cases := []struct {
		name string
		data []byte
	}{
		{"missing manifest", build(func(zw *zip.Writer) {
			_ = addBytesEntry(zw, "data/places.json", []byte("[]"))
		})},
		{"wrong format", build(func(zw *zip.Writer) {
			_ = addJSONEntry(zw, "manifest.json", map[string]any{"format": "other", "schemaVersion": 1})
		})},
		{"future schema", build(func(zw *zip.Writer) {
			_ = addJSONEntry(zw, "manifest.json", map[string]any{"format": Format, "schemaVersion": 99})
		})},
		{"unknown data file", build(func(zw *zip.Writer) {
			_ = addJSONEntry(zw, "manifest.json", newManifest())
			_ = addBytesEntry(zw, "data/evil.json", []byte("{}"))
		})},
		{"corrupt json", build(func(zw *zip.Writer) {
			_ = addJSONEntry(zw, "manifest.json", newManifest())
			_ = addBytesEntry(zw, "data/places.json", []byte("{not json"))
		})},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			dst := t.TempDir()
			_, err := ValidateAndStage(dst, int64(len(c.data)), bytes.NewReader(c.data))
			if err == nil {
				t.Fatal("expected rejection")
			}
			if entries, _ := os.ReadDir(dst); len(entries) != 0 {
				t.Errorf("staging not cleaned up: %v", entries)
			}
		})
	}
}

// TestNewAtlas produces a blank, complete Atlas and a backup.
func TestNewAtlas(t *testing.T) {
	src := buildFixture(t)
	backupRel, err := NewAtlas(src, "night")
	if err != nil {
		t.Fatalf("new atlas: %v", err)
	}
	if _, err := os.Stat(filepath.Join(src, backupRel)); err != nil {
		t.Fatalf("backup not created: %v", err)
	}
	places, _ := os.ReadFile(filepath.Join(src, "data", "places.json"))
	if string(bytes.TrimSpace(places)) != "[]" {
		t.Errorf("places not blank: %s", places)
	}
	if entries, _ := os.ReadDir(filepath.Join(src, "media")); len(entries) != 0 {
		t.Errorf("media not cleared: %v", entries)
	}
	settings, _ := os.ReadFile(filepath.Join(src, "data", "settings.json"))
	if !bytes.Contains(settings, []byte(`"night"`)) {
		t.Errorf("theme preference not kept: %s", settings)
	}
}
