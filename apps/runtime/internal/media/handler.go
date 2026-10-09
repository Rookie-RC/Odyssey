// Package media serves the user's media files from <dataDir>/media, plus
// on-demand, disk-cached JPEG thumbnails of them (?w=N).
//
// Thumbnails are produced with the standard library only: image/jpeg,
// image/png and image/gif decode; a hand-written area-averaging (box) filter
// downscales; EXIF orientation is applied so phone photos come out upright
// like the originals do in the browser; image/jpeg encodes at quality 82.
package media

import (
	"errors"
	"io/fs"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// NewHandler serves /media/<path> from <dataDir>/media so the frontend can
// reference local images by stable paths (PRODUCT_SPEC §10 storage layout).
// It is a read-only, traversal-safe file server: only GET/HEAD, only existing
// regular files, no directory listings.
//
// With ?w=N (see ParseWidth) it answers with a JPEG at most N pixels wide,
// Cache-Control: public, max-age=86400. The original is served instead when
// it is not wider than N (never upscale), when it cannot be decoded (WebP,
// AVIF, corrupt files) or when thumbnailing fails for any other reason.
// thumbs may be nil to disable thumbnails.
func NewHandler(dataDir string, thumbs *Thumbnailer) http.Handler {
	mediaRoot := filepath.Join(dataDir, "media")
	if abs, err := filepath.Abs(mediaRoot); err == nil {
		mediaRoot = abs // the thumbnail cache key uses absolute source paths
	}
	fsys := os.DirFS(mediaRoot)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		name, ok := mediaName(r.URL.Path)
		if !ok {
			http.NotFound(w, r)
			return
		}
		info, err := fs.Stat(fsys, name)
		if err != nil || !info.Mode().IsRegular() {
			http.NotFound(w, r)
			return
		}
		if thumbs != nil {
			if width, ok := ParseWidth(r.URL.Query().Get("w")); ok {
				// name passed mediaName and os.DirFS's own validation, so it
				// is a clean relative path that stays inside mediaRoot.
				src := filepath.Join(mediaRoot, filepath.FromSlash(name))
				thumb, err := thumbs.Get(src, info, width)
				if err != nil && !errors.Is(err, errUnsupported) {
					log.Printf("thumbnail %s (w=%d): %v; serving original", name, width, err)
				}
				if thumb != "" && serveThumb(w, r, thumb, info.ModTime()) {
					return
				}
			}
		}
		http.ServeFileFS(w, r, fsys, name)
	})
}

// mediaName extracts the media-relative path from a /media/... URL path and
// rejects anything that could leave the media root: parent references
// (including inside a segment, conservatively), absolute paths, backslashes
// (path separators on Windows), and anything io/fs does not consider a valid
// clean path. os.DirFS additionally rejects drive letters/colons on Windows.
func mediaName(urlPath string) (string, bool) {
	name := strings.TrimPrefix(urlPath, "/media/")
	if name == "" || name == urlPath || strings.Contains(name, "..") || strings.ContainsRune(name, '\\') {
		return "", false
	}
	if !fs.ValidPath(name) {
		return "", false
	}
	return name, true
}

// serveThumb writes a cached thumbnail. The ETag is the cache key (the file
// name), and Last-Modified is the original's mtime — the thumbnail's content
// is a pure function of both. It reports false if the file vanished (e.g. the
// OS cleaned the cache) so the caller can fall back to the original.
func serveThumb(w http.ResponseWriter, r *http.Request, path string, modTime time.Time) bool {
	f, err := os.Open(path)
	if err != nil {
		return false
	}
	defer f.Close()
	h := w.Header()
	h.Set("Content-Type", "image/jpeg")
	h.Set("Cache-Control", "public, max-age=86400")
	h.Set("ETag", `"`+strings.TrimSuffix(filepath.Base(path), ".jpg")+`"`)
	http.ServeContent(w, r, "", modTime, f)
	return true
}
