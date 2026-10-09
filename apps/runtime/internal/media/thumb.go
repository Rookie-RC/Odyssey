package media

import (
	"bufio"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"image"
	"image/color"
	_ "image/gif" // register GIF (first frame) for image.Decode
	"image/jpeg"
	_ "image/png" // register PNG for image.Decode
	"io"
	"io/fs"
	"math"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

// ThumbWidths are the widths ?w= may resolve to. A fixed ladder keeps the
// cache bounded (at most len(ThumbWidths) thumbnails per photo) and lets the
// browser reuse one size for slightly different layout widths.
var ThumbWidths = []int{160, 320, 640, 960, 1280, 1920}

const (
	// thumbQuality is the JPEG quality of generated thumbnails: visually
	// clean for photos at a fraction of the original's size.
	thumbQuality = 82
	// thumbVersion is mixed into every cache key so a change to the
	// resampling/encoding code never serves thumbnails made by the old one.
	thumbVersion = "v1-box-q82"
	// maxSourcePixels guards memory: a larger source (or a crafted header
	// claiming one) is served as the original instead of decoded.
	maxSourcePixels = 100_000_000
)

// ParseWidth turns a ?w= value into a thumbnail width from ThumbWidths,
// rounding up to the nearest allowed width (w=500 → 640). ok is false — serve
// the original — for an empty, non-numeric or non-positive value, and for
// anything above the largest width (the caller wants full quality).
func ParseWidth(v string) (width int, ok bool) {
	if v == "" {
		return 0, false
	}
	n, err := strconv.Atoi(v)
	if err != nil || n <= 0 {
		return 0, false
	}
	for _, w := range ThumbWidths {
		if n <= w {
			return w, true
		}
	}
	return 0, false
}

// DefaultCacheDir returns where thumbnails are cached:
// <os.UserCacheDir()>/YuAtlas/thumbs, or <os.TempDir()>/YuAtlas/thumbs when
// there is no user cache directory.
//
// Thumbnails are derived data and must never land inside the Atlas data
// directory: everything there is user content that export/backup packages
// (and that the user copies around). If the user cache dir happens to lie
// inside dataDir, the temp dir is used instead.
func DefaultCacheDir(dataDir string) string {
	base, err := os.UserCacheDir()
	if err != nil || base == "" {
		base = os.TempDir()
	}
	dir := filepath.Join(base, "YuAtlas", "thumbs")
	if isWithin(dir, dataDir) {
		dir = filepath.Join(os.TempDir(), "YuAtlas", "thumbs")
	}
	return dir
}

// isWithin reports whether path is root or lies below it.
func isWithin(path, root string) bool {
	ap, err1 := filepath.Abs(path)
	ar, err2 := filepath.Abs(root)
	if err1 != nil || err2 != nil {
		return false
	}
	rel, err := filepath.Rel(ar, ap)
	return err == nil && rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator)) && !filepath.IsAbs(rel)
}

// Thumbnailer produces downscaled JPEGs and caches them on disk.
//
// Concurrency: requests for the same thumbnail are collapsed (flightGroup),
// so a page that asks for one photo twice while it is being generated decodes
// it once; and at most a few different thumbnails are generated at the same
// time (sem), because decoding a 12-megapixel photo costs tens of MB and a
// gallery can request dozens at once.
type Thumbnailer struct {
	dir   string
	sem   chan struct{}
	group flightGroup

	renders atomic.Int64 // number of thumbnails actually generated (tests)
}

// NewThumbnailer returns a Thumbnailer caching into dir (created on demand).
func NewThumbnailer(dir string) *Thumbnailer {
	n := runtime.NumCPU()
	if n > 4 {
		n = 4
	}
	if n < 1 {
		n = 1
	}
	return &Thumbnailer{dir: dir, sem: make(chan struct{}, n)}
}

// errUnsupported marks sources that are simply not decodable here (WebP,
// AVIF, non-images …): the caller serves the original without logging.
var errUnsupported = errors.New("unsupported image format")

// Get returns the path of a cached JPEG of src scaled to width (the displayed
// width, after EXIF orientation), generating it if needed. It returns "" and
// a nil error when the original should be served as is — it is not wider
// than width (thumbnails never upscale). Any error also means "serve the
// original".
func (t *Thumbnailer) Get(src string, info fs.FileInfo, width int) (string, error) {
	key := cacheKey(src, info.Size(), info.ModTime(), width)
	dst := filepath.Join(t.dir, key+".jpg")
	if regularFile(dst) {
		return dst, nil
	}
	return t.group.do(key, func() (string, error) {
		// A call for this key may have finished between the check above and
		// joining the group.
		if regularFile(dst) {
			return dst, nil
		}
		orientation, need, err := probe(src, width)
		if err != nil || !need {
			return "", err
		}
		t.sem <- struct{}{}
		defer func() { <-t.sem }()
		if err := t.render(src, dst, width, orientation); err != nil {
			return "", err
		}
		t.renders.Add(1)
		return dst, nil
	})
}

// cacheKey identifies a thumbnail: the same file (absolute path) at the same
// size and modification time, scaled to the same width, by the same code
// version. Editing or replacing the original changes size/mtime and thus the
// key, so stale thumbnails are never served (old ones are simply orphaned).
func cacheKey(absPath string, size int64, mtime time.Time, width int) string {
	h := sha256.New()
	fmt.Fprintf(h, "%s\x00%s\x00%d\x00%d\x00%d", thumbVersion, absPath, size, mtime.UnixNano(), width)
	return hex.EncodeToString(h.Sum(nil))
}

func regularFile(p string) bool {
	info, err := os.Stat(p)
	return err == nil && info.Mode().IsRegular()
}

// probe reads only the image header: the format, dimensions and (for JPEG)
// EXIF orientation. need is false when the displayed width already fits.
func probe(src string, width int) (orientation int, need bool, err error) {
	f, err := os.Open(src)
	if err != nil {
		return 0, false, err
	}
	defer f.Close()
	cfg, format, err := image.DecodeConfig(bufio.NewReader(f))
	if err != nil {
		return 0, false, errUnsupported
	}
	orientation = 1
	if format == "jpeg" {
		if _, err := f.Seek(0, io.SeekStart); err != nil {
			return 0, false, err
		}
		orientation = jpegOrientation(f)
	}
	displayW := cfg.Width
	if orientation >= 5 {
		displayW = cfg.Height
	}
	if displayW <= width {
		return orientation, false, nil
	}
	if int64(cfg.Width)*int64(cfg.Height) > maxSourcePixels {
		return 0, false, fmt.Errorf("image too large to thumbnail (%dx%d)", cfg.Width, cfg.Height)
	}
	return orientation, true, nil
}

// render decodes src, scales it to width (displayed orientation) and writes
// the JPEG to dst atomically (temp file + rename), so a concurrent reader
// never sees a half-written thumbnail.
func (t *Thumbnailer) render(src, dst string, width, orientation int) error {
	f, err := os.Open(src)
	if err != nil {
		return err
	}
	img, _, err := image.Decode(bufio.NewReaderSize(f, 64<<10))
	f.Close()
	if err != nil {
		return fmt.Errorf("decode %s: %w", filepath.Base(src), err)
	}
	out := scaleOriented(img, width, orientation)

	if err := os.MkdirAll(t.dir, 0o755); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(t.dir, ".thumb-*.tmp")
	if err != nil {
		return err
	}
	tmpName := tmp.Name()
	bw := bufio.NewWriterSize(tmp, 64<<10)
	err = jpeg.Encode(bw, out, &jpeg.Options{Quality: thumbQuality})
	if err == nil {
		err = bw.Flush()
	}
	if cerr := tmp.Close(); err == nil {
		err = cerr
	}
	if err != nil {
		_ = os.Remove(tmpName)
		return err
	}
	if err := os.Rename(tmpName, dst); err != nil {
		_ = os.Remove(tmpName)
		// Another process (a second Atlas instance sharing the cache) may
		// have won the race; its file is just as good.
		if regularFile(dst) {
			return nil
		}
		return err
	}
	return nil
}

// scaleOriented returns img scaled to width×(proportional height) as it is
// displayed, i.e. after applying the EXIF orientation. Scaling happens first,
// in the stored orientation (so the expensive pass never moves pixels around),
// and the cheap rotate/flip is applied to the small result.
func scaleOriented(img image.Image, width, orientation int) *image.RGBA {
	b := img.Bounds()
	displayW, displayH := b.Dx(), b.Dy()
	if orientation >= 5 {
		displayW, displayH = displayH, displayW
	}
	tw := width
	if tw > displayW {
		tw = displayW
	}
	th := int(math.Round(float64(displayH) * float64(tw) / float64(displayW)))
	if th < 1 {
		th = 1
	}
	// Target size in the stored orientation.
	sw, sh := tw, th
	if orientation >= 5 {
		sw, sh = th, tw
	}
	acc := boxScale(img, sw, sh)

	out := image.NewRGBA(image.Rect(0, 0, tw, th))
	for dy := 0; dy < th; dy++ {
		row := out.Pix[dy*out.Stride:]
		for dx := 0; dx < tw; dx++ {
			sx, sy := orientedSourcePixel(orientation, dx, dy, sw, sh)
			p := acc[(sy*sw+sx)*4:]
			// acc is premultiplied; composite over white so transparent
			// PNG/GIF areas become white rather than JPEG black.
			white := 1 - p[3]
			row[dx*4+0] = to8(p[0] + white)
			row[dx*4+1] = to8(p[1] + white)
			row[dx*4+2] = to8(p[2] + white)
			row[dx*4+3] = 0xFF
		}
	}
	return out
}

func to8(v float32) uint8 {
	v = v*255 + 0.5
	if v <= 0 {
		return 0
	}
	if v >= 255 {
		return 255
	}
	return uint8(v)
}

// tap is one input sample's contribution to an output sample.
type tap struct {
	idx int
	w   float32
}

// boxTaps computes the area-averaging (box) filter for resampling n input
// samples to m outputs: output i covers the input interval
// [i·n/m, (i+1)·n/m), and each input sample contributes in proportion to how
// much of it lies inside that interval (partial coverage at both edges). The
// weights of every output sum to 1. This is exact area averaging, so it does
// not alias the way nearest-neighbour or plain bilinear do at large
// reduction factors.
func boxTaps(n, m int) [][]tap {
	scale := float64(n) / float64(m)
	taps := make([][]tap, m)
	for i := range taps {
		start := float64(i) * scale
		end := float64(i+1) * scale
		j0 := int(math.Floor(start))
		j1 := int(math.Ceil(end))
		if j1 > n {
			j1 = n
		}
		list := make([]tap, 0, j1-j0)
		for j := j0; j < j1; j++ {
			cover := math.Min(end, float64(j+1)) - math.Max(start, float64(j))
			if cover > 1e-9 {
				list = append(list, tap{j, float32(cover / scale)})
			}
		}
		taps[i] = list
	}
	return taps
}

// boxScale resamples img to dw×dh with a separable box filter and returns
// premultiplied RGBA in [0,1], row-major, 4 floats per pixel.
//
// Source rows are streamed once: each row is converted, reduced
// horizontally, and accumulated into the (at most two) output rows it
// overlaps. Memory is one source row plus the small output, never a full
// float copy of the source.
func boxScale(img image.Image, dw, dh int) []float32 {
	b := img.Bounds()
	sw, sh := b.Dx(), b.Dy()
	xTaps := boxTaps(sw, dw)
	yTaps := boxTaps(sh, dh)

	// Invert the vertical taps: for each source row, the output rows it
	// feeds.
	rowTo := make([][]tap, sh)
	for i, list := range yTaps {
		for _, t := range list {
			rowTo[t.idx] = append(rowTo[t.idx], tap{i, t.w})
		}
	}

	read := rowReader(img)
	src := make([]float32, sw*4)
	hrow := make([]float32, dw*4)
	acc := make([]float32, dw*dh*4)
	for y := 0; y < sh; y++ {
		if len(rowTo[y]) == 0 {
			continue
		}
		read(y, src)
		for x, list := range xTaps {
			var r, g, bl, a float32
			for _, t := range list {
				p := src[t.idx*4 : t.idx*4+4]
				r += p[0] * t.w
				g += p[1] * t.w
				bl += p[2] * t.w
				a += p[3] * t.w
			}
			h := hrow[x*4 : x*4+4]
			h[0], h[1], h[2], h[3] = r, g, bl, a
		}
		for _, t := range rowTo[y] {
			dst := acc[t.idx*dw*4 : (t.idx+1)*dw*4]
			for k, v := range hrow {
				dst[k] += v * t.w
			}
		}
	}
	return acc
}

// rowReader returns a function that writes row y (0-based within the
// bounds) of img into dst as premultiplied RGBA floats in [0,1]. The common
// decoder outputs are read directly from their pixel buffers; anything else
// goes through the generic (slower) color.Color path.
func rowReader(img image.Image) func(y int, dst []float32) {
	b := img.Bounds()
	w := b.Dx()
	const inv = 1.0 / 255
	switch m := img.(type) {
	case *image.YCbCr: // JPEG
		return func(y int, dst []float32) {
			sy := b.Min.Y + y
			for x := 0; x < w; x++ {
				sx := b.Min.X + x
				yi, ci := m.YOffset(sx, sy), m.COffset(sx, sy)
				r, g, bl := color.YCbCrToRGB(m.Y[yi], m.Cb[ci], m.Cr[ci])
				d := dst[x*4 : x*4+4]
				d[0], d[1], d[2], d[3] = float32(r)*inv, float32(g)*inv, float32(bl)*inv, 1
			}
		}
	case *image.Gray: // grayscale JPEG/PNG
		return func(y int, dst []float32) {
			row := m.Pix[m.PixOffset(b.Min.X, b.Min.Y+y):]
			for x := 0; x < w; x++ {
				v := float32(row[x]) * inv
				d := dst[x*4 : x*4+4]
				d[0], d[1], d[2], d[3] = v, v, v, 1
			}
		}
	case *image.RGBA: // already premultiplied
		return func(y int, dst []float32) {
			row := m.Pix[m.PixOffset(b.Min.X, b.Min.Y+y):]
			for x := 0; x < w*4; x++ {
				dst[x] = float32(row[x]) * inv
			}
		}
	case *image.NRGBA: // PNG with alpha: premultiply before averaging
		return func(y int, dst []float32) {
			row := m.Pix[m.PixOffset(b.Min.X, b.Min.Y+y):]
			for x := 0; x < w; x++ {
				p := row[x*4 : x*4+4]
				a := float32(p[3]) * inv
				d := dst[x*4 : x*4+4]
				d[0], d[1], d[2], d[3] = float32(p[0])*inv*a, float32(p[1])*inv*a, float32(p[2])*inv*a, a
			}
		}
	default: // paletted GIF/PNG, 16-bit PNG, CMYK JPEG, …
		return func(y int, dst []float32) {
			sy := b.Min.Y + y
			const inv16 = 1.0 / 0xFFFF
			for x := 0; x < w; x++ {
				r, g, bl, a := img.At(b.Min.X+x, sy).RGBA() // premultiplied
				d := dst[x*4 : x*4+4]
				d[0], d[1], d[2], d[3] = float32(r)*inv16, float32(g)*inv16, float32(bl)*inv16, float32(a)*inv16
			}
		}
	}
}

// flightGroup collapses concurrent calls with the same key into one
// execution whose result all callers share (a minimal, stdlib-only
// singleflight).
type flightGroup struct {
	mu    sync.Mutex
	calls map[string]*flightCall
}

type flightCall struct {
	done chan struct{}
	path string
	err  error
}

func (g *flightGroup) do(key string, fn func() (string, error)) (string, error) {
	g.mu.Lock()
	if c, ok := g.calls[key]; ok {
		g.mu.Unlock()
		<-c.done
		return c.path, c.err
	}
	if g.calls == nil {
		g.calls = map[string]*flightCall{}
	}
	c := &flightCall{done: make(chan struct{}), err: errors.New("thumbnail generation aborted")}
	g.calls[key] = c
	g.mu.Unlock()

	// Deferred so waiters are released even if fn panics (net/http recovers
	// handler panics; without this they would block forever).
	defer func() {
		g.mu.Lock()
		delete(g.calls, key)
		g.mu.Unlock()
		close(c.done)
	}()
	c.path, c.err = fn()
	return c.path, c.err
}
