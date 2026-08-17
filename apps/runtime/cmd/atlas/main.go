// Command atlas runs the local Yu's Atlas runtime: it serves the embedded
// frontend, exposes the local JSON API, proxies/normalizes geocoding requests,
// and opens the default browser.
package main

import (
	"context"
	"flag"
	"fmt"
	"io/fs"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
	"time"

	"github.com/yuatlas/runtime/assets"
	"github.com/yuatlas/runtime/internal/api"
	"github.com/yuatlas/runtime/internal/config"
	"github.com/yuatlas/runtime/internal/geocode"
	"github.com/yuatlas/runtime/internal/storage"
)

func main() {
	var (
		dataDir     = flag.String("data", "", "path to atlas-data directory (default: deterministic discovery)")
		port        = flag.Int("port", 4317, "preferred HTTP port (falls back to a free port)")
		host        = flag.String("host", "127.0.0.1", "bind address")
		openBrowser = flag.Bool("open-browser", true, "open the default browser on startup")
	)
	flag.Parse()

	dir, err := resolveDataDir(*dataDir)
	if err != nil {
		log.Fatalf("resolve data directory: %v", err)
	}

	repo := storage.NewRepository(dir)
	if err := repo.Ensure(); err != nil {
		log.Fatalf("initialize data directory: %v", err)
	}

	cfg := config.Load(dir)
	geocoder := geocode.NewManager(selectProvider(cfg))

	ln, err := net.Listen("tcp", net.JoinHostPort(*host, fmt.Sprintf("%d", *port)))
	if err != nil {
		log.Printf("port %d unavailable (%v); choosing a free port", *port, err)
		ln, err = net.Listen("tcp", net.JoinHostPort(*host, "0"))
		if err != nil {
			log.Fatalf("listen: %v", err)
		}
	}
	actualPort := ln.Addr().(*net.TCPAddr).Port

	srv := api.NewServer(repo, geocoder, dir, actualPort)

	mux := http.NewServeMux()
	mux.Handle("/api/", srv.Handler())
	mux.Handle("/media/", mediaHandler(dir))
	mux.Handle("/", staticHandler())

	url := fmt.Sprintf("http://127.0.0.1:%d", actualPort)
	httpServer := &http.Server{Handler: corsMiddleware(mux)}

	go func() {
		log.Printf("Yu's Atlas runtime listening on %s", url)
		log.Printf("data directory: %s", dir)
		log.Printf("geocoding provider: %s", geocoder.ProviderID())
		if err := httpServer.Serve(ln); err != nil && err != http.ErrServerClosed {
			log.Fatalf("server error: %v", err)
		}
	}()

	if *openBrowser {
		openBrowserURL(url)
	}

	// Graceful shutdown on Ctrl-C.
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	<-stop
	log.Println("shutting down")
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = httpServer.Shutdown(ctx)
}

// resolveDataDir returns the absolute path of the atlas-data directory to use.
// Priority:
//
//  1. the explicit -data flag,
//  2. the YUATLAS_DATA environment variable,
//  3. discovery of an existing atlas-data directory (see discoverDataDir),
//  4. a fresh <cwd>/atlas-data, created by storage.Ensure.
//
// The result is always an absolute path so the effective location is
// unambiguous regardless of the process working directory, and it is exposed
// through GET /api/runtime for debugging.
func resolveDataDir(explicit string) (string, error) {
	dir := explicit
	if dir == "" {
		dir = os.Getenv("YUATLAS_DATA")
	}
	if dir == "" {
		dir = discoverDataDir()
	}
	abs, err := filepath.Abs(dir)
	if err != nil {
		return "", err
	}
	return filepath.Clean(abs), nil
}

// discoverDataDir locates an existing atlas-data directory so repeated
// launches resolve to the same data regardless of the working directory:
//
//  1. <executable-dir>/atlas-data  — packaged installs (binary + data side by side),
//  2. <cwd>/atlas-data             — classic "run me here" layout,
//  3. <cwd>/apps/runtime/atlas-data — dev tree launched from the repo root,
//  4. <cwd>/examples/atlas-data     — sample data.
//
// If no existing directory matches, the default <cwd>/atlas-data is returned
// and created fresh by storage.Ensure.
func discoverDataDir() string {
	var candidates []string
	if exe, err := os.Executable(); err == nil {
		candidates = append(candidates, filepath.Join(filepath.Dir(exe), "atlas-data"))
	}
	candidates = append(candidates,
		"atlas-data",
		filepath.Join("apps", "runtime", "atlas-data"),
		filepath.Join("examples", "atlas-data"),
	)
	for _, c := range candidates {
		if info, err := os.Stat(c); err == nil && info.IsDir() {
			return c
		}
	}
	return "atlas-data"
}

func selectProvider(cfg config.Config) geocode.Provider {
	switch cfg.GeocodingProvider {
	case "photon", "":
		return geocode.NewPhotonProvider()
	default:
		log.Printf("unknown geocoding provider %q; falling back to photon", cfg.GeocodingProvider)
		return geocode.NewPhotonProvider()
	}
}

func staticHandler() http.Handler {
	sub := assets.FS()
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p := strings.TrimPrefix(r.URL.Path, "/")
		if p == "" {
			p = "index.html"
		}
		if _, err := fs.Stat(sub, p); err != nil {
			p = "index.html" // SPA fallback
		}
		http.ServeFileFS(w, r, sub, p)
	})
}

// mediaHandler serves the user's media files from <dataDir>/media so the
// frontend can reference local images by stable /media/<place>/<file> paths
// (PRODUCT_SPEC §10 storage layout). It is a read-only, traversal-safe file
// server: only GET/HEAD, only existing regular files, no directory listings.
func mediaHandler(dataDir string) http.Handler {
	mediaRoot := filepath.Join(dataDir, "media")
	fsys := os.DirFS(mediaRoot)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		name := strings.TrimPrefix(r.URL.Path, "/media/")
		if name == "" || strings.Contains(name, "..") {
			http.NotFound(w, r)
			return
		}
		info, err := fs.Stat(fsys, name)
		if err != nil || info.IsDir() {
			http.NotFound(w, r)
			return
		}
		http.ServeFileFS(w, r, fsys, name)
	})
}

func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func openBrowserURL(url string) {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		cmd = exec.Command("open", url)
	case "windows":
		cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", url)
	default:
		cmd = exec.Command("xdg-open", url)
	}
	if err := cmd.Start(); err != nil {
		log.Printf("could not open browser: %v", err)
	}
}
