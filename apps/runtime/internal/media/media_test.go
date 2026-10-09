package media

import (
	"bytes"
	"encoding/binary"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"io/fs"
	"math"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"sync"
	"testing"
)

// --- fixtures ---

// twoTone returns a w×h image whose left half is red and right half blue,
// so any rotation/flip is visible in the output.
func twoTone(w, h int) *image.RGBA {
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			c := color.RGBA{255, 0, 0, 255}
			if x >= w/2 {
				c = color.RGBA{0, 0, 255, 255}
			}
			img.SetRGBA(x, y, c)
		}
	}
	return img
}

func encodePNG(t *testing.T, img image.Image) []byte {
	t.Helper()
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

// exifAPP1 builds an APP1 segment (marker + length + "Exif\0\0" + TIFF)
// whose IFD0 holds a single Orientation entry.
func exifAPP1(orientation int, bo binary.ByteOrder) []byte {
	var tiff bytes.Buffer
	if bo == binary.LittleEndian {
		tiff.WriteString("II")
	} else {
		tiff.WriteString("MM")
	}
	w := func(v any) { _ = binary.Write(&tiff, bo, v) }
	w(uint16(42))
	w(uint32(8))      // IFD0 offset
	w(uint16(1))      // one entry
	w(uint16(0x0112)) // Orientation
	w(uint16(3))      // SHORT
	w(uint32(1))      // count
	w(uint16(orientation))
	w(uint16(0))
	w(uint32(0)) // no next IFD
	payload := append([]byte("Exif\x00\x00"), tiff.Bytes()...)
	n := len(payload) + 2
	return append([]byte{0xFF, 0xE1, byte(n >> 8), byte(n)}, payload...)
}

// encodeJPEGWithOrientation encodes img and inserts extra segments right
// after SOI, as cameras do.
func encodeJPEGWithOrientation(t *testing.T, img image.Image, segments ...[]byte) []byte {
	t.Helper()
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, img, &jpeg.Options{Quality: 95}); err != nil {
		t.Fatal(err)
	}
	b := buf.Bytes()
	out := append([]byte{}, b[:2]...) // SOI
	for _, s := range segments {
		out = append(out, s...)
	}
	return append(out, b[2:]...)
}

type env struct {
	dataDir, cacheDir string
	thumbs            *Thumbnailer
	h                 http.Handler
}

func newEnv(t *testing.T, files map[string][]byte) env {
	t.Helper()
	dataDir, cacheDir := t.TempDir(), t.TempDir()
	for rel, b := range files {
		p := filepath.Join(dataDir, "media", filepath.FromSlash(rel))
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, b, 0o644); err != nil {
			t.Fatal(err)
		}
	}
	// A private file next to media/ that traversal must never reach.
	if err := os.MkdirAll(filepath.Join(dataDir, "data"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dataDir, "data", "places.json"), []byte(`["secret"]`), 0o644); err != nil {
		t.Fatal(err)
	}
	th := NewThumbnailer(cacheDir)
	return env{dataDir, cacheDir, th, NewHandler(dataDir, th)}
}

func get(h http.Handler, target string) *httptest.ResponseRecorder {
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("GET", target, nil))
	return w
}

func decodeJPEG(t *testing.T, w *httptest.ResponseRecorder) image.Image {
	t.Helper()
	if ct := w.Header().Get("Content-Type"); ct != "image/jpeg" {
		t.Fatalf("Content-Type = %q, want image/jpeg (status %d)", ct, w.Code)
	}
	img, err := jpeg.Decode(bytes.NewReader(w.Body.Bytes()))
	if err != nil {
		t.Fatalf("thumbnail is not a JPEG: %v", err)
	}
	return img
}

func isRed(c color.Color) bool {
	r, g, b, _ := c.RGBA()
	return r>>8 > 200 && g>>8 < 60 && b>>8 < 60
}

func isBlue(c color.Color) bool {
	r, g, b, _ := c.RGBA()
	return b>>8 > 200 && r>>8 < 60 && g>>8 < 60
}

// --- traversal safety ---

func TestMediaTraversalRejected(t *testing.T) {
	e := newEnv(t, map[string][]byte{"bordeaux/bourse.png": encodePNG(t, twoTone(4, 4))})

	if w := get(e.h, "/media/bordeaux/bourse.png"); w.Code != http.StatusOK {
		t.Fatalf("legit file: %d", w.Code)
	}
	for _, target := range []string{
		"/media/../data/places.json",
		"/media/%2e%2e/data/places.json",
		"/media/bordeaux/../../data/places.json",
		"/media/bordeaux/%2E%2E/%2E%2E/data/places.json",
		"/media/..%5Cdata%5Cplaces.json",
		"/media//etc/passwd",
		"/media/",
		"/media/bordeaux", // directory: no listings
		"/media/bordeaux/",
		"/media/missing.jpg",
		"/media/../data/places.json?w=320",
	} {
		w := get(e.h, target)
		if w.Code != http.StatusNotFound {
			t.Errorf("%s: status %d, want 404", target, w.Code)
		}
		if bytes.Contains(w.Body.Bytes(), []byte("secret")) {
			t.Errorf("%s leaked a file outside media/", target)
		}
	}

	w := httptest.NewRecorder()
	e.h.ServeHTTP(w, httptest.NewRequest("POST", "/media/bordeaux/bourse.png", nil))
	if w.Code != http.StatusMethodNotAllowed {
		t.Errorf("POST: %d, want 405", w.Code)
	}
}

// --- thumbnails ---

func TestParseWidth(t *testing.T) {
	for in, want := range map[string]int{
		"160": 160, "1": 160, "161": 320, "320": 320, "500": 640, "640": 640,
		"961": 1280, "1920": 1920,
		"": 0, "abc": 0, "0": 0, "-5": 0, "1921": 0, "4000": 0, "3.5": 0,
	} {
		got, ok := ParseWidth(in)
		if (want == 0) == ok || got != want {
			t.Errorf("ParseWidth(%q) = %d, %v; want %d", in, got, ok, want)
		}
	}
}

func TestThumbnailPNG(t *testing.T) {
	// Gradient plus deterministic noise in the blue channel: photo-like
	// content that PNG cannot compress away, so the size comparison is fair.
	src := image.NewNRGBA(image.Rect(0, 0, 640, 480))
	seed := uint32(1)
	for y := 0; y < 480; y++ {
		for x := 0; x < 640; x++ {
			seed = seed*1664525 + 1013904223
			src.SetNRGBA(x, y, color.NRGBA{uint8(x * 255 / 639), uint8(y * 255 / 479), uint8(seed >> 24), 255})
		}
	}
	orig := encodePNG(t, src)
	e := newEnv(t, map[string][]byte{"lofoten/reine.png": orig})

	w := get(e.h, "/media/lofoten/reine.png?w=300") // rounds up to 320
	if w.Code != http.StatusOK {
		t.Fatalf("status %d: %s", w.Code, w.Body.String())
	}
	img := decodeJPEG(t, w)
	if b := img.Bounds(); b.Dx() != 320 || b.Dy() != 240 {
		t.Fatalf("thumbnail is %dx%d, want 320x240", b.Dx(), b.Dy())
	}
	if cc := w.Header().Get("Cache-Control"); cc != "public, max-age=86400" {
		t.Errorf("Cache-Control = %q", cc)
	}
	if w.Body.Len() >= len(orig) {
		t.Errorf("thumbnail (%d bytes) not smaller than original (%d bytes)", w.Body.Len(), len(orig))
	}
	// The gradient survives the box filter (corners keep their colours).
	if r, _, _, _ := img.At(318, 120).RGBA(); r>>8 < 230 {
		t.Errorf("right edge red = %d, want ≈255", r>>8)
	}

	// Cached on disk in the cache dir, never in the data dir.
	cached, _ := os.ReadDir(e.cacheDir)
	if len(cached) != 1 {
		t.Fatalf("cache dir has %d entries, want 1", len(cached))
	}
	_ = filepath.WalkDir(e.dataDir, func(p string, d fs.DirEntry, err error) error {
		if err == nil && !d.IsDir() && filepath.Ext(p) == ".jpg" {
			t.Errorf("thumbnail written into the data dir: %s", p)
		}
		return nil
	})

	// Second request: served from cache; conditional request → 304.
	w2 := get(e.h, "/media/lofoten/reine.png?w=320")
	if !bytes.Equal(w2.Body.Bytes(), w.Body.Bytes()) {
		t.Error("cached thumbnail differs")
	}
	if n := e.thumbs.renders.Load(); n != 1 {
		t.Errorf("rendered %d times, want 1", n)
	}
	req := httptest.NewRequest("GET", "/media/lofoten/reine.png?w=320", nil)
	req.Header.Set("If-None-Match", w.Header().Get("ETag"))
	w3 := httptest.NewRecorder()
	e.h.ServeHTTP(w3, req)
	if w3.Code != http.StatusNotModified {
		t.Errorf("If-None-Match: status %d, want 304", w3.Code)
	}

	// A changed original gets a new thumbnail (size/mtime are in the key).
	p := filepath.Join(e.dataDir, "media", "lofoten", "reine.png")
	if err := os.WriteFile(p, encodePNG(t, twoTone(800, 400)), 0o644); err != nil {
		t.Fatal(err)
	}
	img = decodeJPEG(t, get(e.h, "/media/lofoten/reine.png?w=320"))
	if b := img.Bounds(); b.Dx() != 320 || b.Dy() != 160 {
		t.Errorf("after change: %dx%d, want 320x160", b.Dx(), b.Dy())
	}
}

// TestThumbnailServesOriginal: no upscaling, unsupported formats, invalid or
// oversized widths all fall back to the untouched original.
func TestThumbnailServesOriginal(t *testing.T) {
	small := encodePNG(t, twoTone(100, 80))
	big := encodePNG(t, twoTone(400, 200))
	webp := []byte("RIFF\x10\x00\x00\x00WEBPVP8 not really")
	e := newEnv(t, map[string][]byte{"a/small.png": small, "a/big.png": big, "a/photo.webp": webp})

	for _, c := range []struct {
		target string
		want   []byte
		ctype  string
	}{
		{"/media/a/small.png?w=160", small, "image/png"}, // never upscale
		{"/media/a/big.png?w=4000", big, "image/png"},    // beyond the ladder
		{"/media/a/big.png?w=abc", big, "image/png"},
		{"/media/a/big.png?w=0", big, "image/png"},
		{"/media/a/big.png", big, "image/png"},
		{"/media/a/photo.webp?w=320", webp, "image/webp"}, // not decodable
	} {
		w := get(e.h, c.target)
		if w.Code != http.StatusOK || !bytes.Equal(w.Body.Bytes(), c.want) {
			t.Errorf("%s: status %d, %d bytes; want the original (%d bytes)", c.target, w.Code, w.Body.Len(), len(c.want))
		}
		if ct := w.Header().Get("Content-Type"); ct != c.ctype {
			t.Errorf("%s: Content-Type %q, want %q", c.target, ct, c.ctype)
		}
	}
	if n := e.thumbs.renders.Load(); n != 0 {
		t.Errorf("rendered %d thumbnails, want 0", n)
	}
}

// TestThumbnailEXIFOrientation: phone photos are stored sideways with an
// orientation tag; thumbnails must come out upright, like the browser shows
// the original.
func TestThumbnailEXIFOrientation(t *testing.T) {
	// Stored image: 400x200, left half red, right half blue.
	src := twoTone(400, 200)
	cases := []struct {
		orientation int
		bo          binary.ByteOrder
		w, h        int
		// colour at the first and second sample point
		first, second func(color.Color) bool
		p1, p2        image.Point
	}{
		// 1: as stored — red left, blue right.
		{1, binary.BigEndian, 160, 80, isRed, isBlue, image.Pt(20, 40), image.Pt(140, 40)},
		// 3: rotated 180° — blue left, red right.
		{3, binary.LittleEndian, 160, 80, isBlue, isRed, image.Pt(20, 40), image.Pt(140, 40)},
		// 6: rotate 90° CW — portrait; stored left edge becomes the top.
		{6, binary.BigEndian, 160, 320, isRed, isBlue, image.Pt(80, 40), image.Pt(80, 280)},
		// 8: rotate 90° CCW — portrait; stored left edge becomes the bottom.
		{8, binary.LittleEndian, 160, 320, isBlue, isRed, image.Pt(80, 40), image.Pt(80, 280)},
		// 2: mirrored — blue left, red right.
		{2, binary.BigEndian, 160, 80, isBlue, isRed, image.Pt(20, 40), image.Pt(140, 40)},
	}
	for _, c := range cases {
		// An XMP APP1 segment before the Exif one must be skipped.
		xmp := append([]byte{0xFF, 0xE1, 0x00, 0x10}, []byte("http://ns.ado\x00")...)
		file := encodeJPEGWithOrientation(t, src, xmp, exifAPP1(c.orientation, c.bo))
		if got := jpegOrientation(bytes.NewReader(file)); got != c.orientation {
			t.Fatalf("parsed orientation %d, want %d", got, c.orientation)
		}
		e := newEnv(t, map[string][]byte{"p/photo.jpg": file})
		w := get(e.h, "/media/p/photo.jpg?w=160")
		img := decodeJPEG(t, w)
		if b := img.Bounds(); b.Dx() != c.w || b.Dy() != c.h {
			t.Errorf("orientation %d: %dx%d, want %dx%d", c.orientation, b.Dx(), b.Dy(), c.w, c.h)
			continue
		}
		if !c.first(img.At(c.p1.X, c.p1.Y)) || !c.second(img.At(c.p2.X, c.p2.Y)) {
			t.Errorf("orientation %d: wrong colours at %v=%v / %v=%v", c.orientation, c.p1, img.At(c.p1.X, c.p1.Y), c.p2, img.At(c.p2.X, c.p2.Y))
		}
	}

	// A portrait (orientation 6) photo whose *displayed* width already fits
	// is served as the original, even though its stored width does not.
	file := encodeJPEGWithOrientation(t, twoTone(400, 150), exifAPP1(6, binary.BigEndian))
	e := newEnv(t, map[string][]byte{"p/narrow.jpg": file})
	if w := get(e.h, "/media/p/narrow.jpg?w=160"); !bytes.Equal(w.Body.Bytes(), file) {
		t.Error("displayed width 150 <= 160 should serve the original")
	}
}

func TestJPEGOrientationMalformed(t *testing.T) {
	for name, b := range map[string][]byte{
		"empty":        nil,
		"not jpeg":     []byte("\x89PNG\r\n"),
		"no exif":      encodeJPEGWithOrientation(t, twoTone(8, 8)),
		"truncated":    {0xFF, 0xD8, 0xFF, 0xE1, 0x00},
		"bad ifd":      {0xFF, 0xD8, 0xFF, 0xE1, 0x00, 0x10, 'E', 'x', 'i', 'f', 0, 0, 'M', 'M', 0, 42, 0xFF, 0xFF, 0xFF, 0xFF},
		"out of range": encodeJPEGWithOrientation(t, twoTone(8, 8), exifAPP1(42, binary.BigEndian)),
	} {
		if got := jpegOrientation(bytes.NewReader(b)); got != 1 {
			t.Errorf("%s: orientation %d, want 1", name, got)
		}
	}
}

// TestThumbnailConcurrent: simultaneous requests for the same thumbnail
// decode the original once and all get the same bytes.
func TestThumbnailConcurrent(t *testing.T) {
	e := newEnv(t, map[string][]byte{"c/big.png": encodePNG(t, twoTone(1200, 800))})
	const n = 12
	bodies := make([][]byte, n)
	var wg sync.WaitGroup
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			w := get(e.h, "/media/c/big.png?w=640")
			if w.Code == http.StatusOK && w.Header().Get("Content-Type") == "image/jpeg" {
				bodies[i] = w.Body.Bytes()
			}
		}(i)
	}
	wg.Wait()
	for i := range bodies {
		if bodies[i] == nil || !bytes.Equal(bodies[i], bodies[0]) {
			t.Fatalf("response %d missing or different", i)
		}
	}
	if r := e.thumbs.renders.Load(); r != 1 {
		t.Errorf("rendered %d times, want 1", r)
	}
	if entries, _ := os.ReadDir(e.cacheDir); len(entries) != 1 {
		t.Errorf("cache dir has %d entries (temp files left?), want 1", len(entries))
	}
}

// TestBoxFilter: weights are a partition of unity and averaging is exact.
func TestBoxFilter(t *testing.T) {
	for _, c := range [][2]int{{10, 3}, {7, 7}, {1000, 160}, {3, 1}, {5, 2}} {
		for i, list := range boxTaps(c[0], c[1]) {
			var sum float64
			for _, tp := range list {
				sum += float64(tp.w)
			}
			if math.Abs(sum-1) > 1e-5 {
				t.Errorf("boxTaps(%d,%d)[%d] sums to %f", c[0], c[1], i, sum)
			}
		}
	}
	// A 2x2 black/white checkerboard averages to exactly mid-grey.
	g := image.NewGray(image.Rect(0, 0, 2, 2))
	g.Pix = []uint8{0, 255, 255, 0}
	acc := boxScale(g, 1, 1)
	if math.Abs(float64(acc[0])-0.5) > 1e-6 || acc[3] != 1 {
		t.Errorf("checkerboard average = %v", acc)
	}
}

func TestDefaultCacheDirOutsideData(t *testing.T) {
	data := t.TempDir()
	if dir := DefaultCacheDir(data); isWithin(dir, data) {
		t.Errorf("cache dir %s inside data dir", dir)
	}
	if runtime.GOOS == "linux" {
		// Even if the user cache dir lies inside the data dir, thumbnails go
		// elsewhere.
		t.Setenv("XDG_CACHE_HOME", filepath.Join(data, "cache"))
		if dir := DefaultCacheDir(data); isWithin(dir, data) {
			t.Errorf("cache dir %s inside data dir", dir)
		}
	}
}
