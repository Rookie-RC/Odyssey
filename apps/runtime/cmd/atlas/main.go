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
	"mime"
	"net"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"runtime"
	"strings"
	"sync/atomic"
	"syscall"
	"time"

	"github.com/yuatlas/runtime/assets"
	"github.com/yuatlas/runtime/internal/api"
	"github.com/yuatlas/runtime/internal/config"
	"github.com/yuatlas/runtime/internal/geocode"
	"github.com/yuatlas/runtime/internal/media"
	"github.com/yuatlas/runtime/internal/storage"
)

func main() {
	var (
		dataDir     = flag.String("data", "", "path to atlas-data directory (default: deterministic discovery)")
		port        = flag.Int("port", 4317, "preferred HTTP port (falls back to a free port)")
		host        = flag.String("host", "127.0.0.1", "bind address")
		openBrowser = flag.Bool("open-browser", true, "open the default browser on startup")
		readonly    = flag.Bool("readonly", false, "serve read-only: reject all API writes and report writable=false")

		mode         = flag.String("mode", "local", "local: one Atlas on this computer; cloud: multi-user web service (accounts, one Atlas per user)")
		publicOrigin = flag.String("public-origin", "", "cloud: comma-separated origins the frontend is served from, e.g. https://atlas.example.com")
		allowSignup  = flag.Bool("allow-signup", true, "cloud: let anyone create an account")
		userQuotaMB  = flag.Int64("user-quota-mb", 500, "cloud: storage per user in MB (photos, data, backups); 0 = unlimited")
		trustProxy   = flag.Bool("trust-proxy", false, "cloud: trust X-Forwarded-For/-Proto from a reverse proxy on this machine")
	)
	flag.Parse()
	configureDNS(os.Getenv("ATLAS_DNS"))

	switch *mode {
	case "local":
	case "cloud":
		runCloud(cloudOptions{
			dataDir:      *dataDir,
			host:         *host,
			port:         *port,
			publicOrigin: *publicOrigin,
			allowSignup:  *allowSignup,
			quotaMB:      *userQuotaMB,
			trustProxy:   *trustProxy,
		})
		return
	default:
		log.Fatalf("unknown -mode %q (want local or cloud)", *mode)
	}

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

	srv := api.NewServer(repo, geocoder, dir, actualPort, !*readonly)

	// Thumbnails are cached outside atlas-data (it is exported/backed up).
	thumbDir := media.DefaultCacheDir(dir)

	mux := http.NewServeMux()
	mux.Handle("/api/", srv.Handler())
	mux.Handle("/media/", media.NewHandler(dir, media.NewThumbnailer(thumbDir)))
	mux.Handle("/", staticHandler())

	// api.Protect applies the Host (DNS-rebinding), Origin (CSRF) and CORS
	// rules, and keeps any client that is not on this device read-only.
	root := api.Protect(mux)

	url := fmt.Sprintf("http://127.0.0.1:%d", actualPort)
	httpServer := &http.Server{Handler: root}

	go func() {
		log.Printf("Odyssey runtime listening on %s", url)
		log.Printf("data directory: %s", dir)
		log.Printf("geocoding provider: %s", geocoder.ProviderID())
		log.Printf("thumbnail cache: %s", thumbDir)
		if *readonly {
			log.Printf("read-only mode: all API writes rejected")
		}
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
//  3. a portable default (see defaultDataDir).
//
// The result is always an absolute path so the effective location never
// depends on the process working directory, and it is exposed through
// GET /api/runtime for debugging.
func resolveDataDir(explicit string) (string, error) {
	dir := explicit
	if dir == "" {
		dir = os.Getenv("YUATLAS_DATA")
	}
	if dir == "" {
		dir = defaultDataDir()
	}
	abs, err := filepath.Abs(dir)
	if err != nil {
		return "", err
	}
	return filepath.Clean(abs), nil
}

// defaultDataDir returns the deterministic, user-writable location for Atlas
// data (PRODUCT_SPEC §2–3: the binary and atlas-data/ are kept side by side so
// replacing the executable never touches user data):
//
//  1. <executable-dir>/atlas-data — the portable layout (Atlas.exe + atlas-data/).
//     Chosen when it already exists, or when the executable's directory is
//     writable (so it can be created there).
//  2. a per-user OS data directory — for read-only install locations (e.g. the
//     executable dropped into Program Files).
//
// The process working directory is never consulted, so launching Atlas from a
// different folder (or a shortcut with a different "Start in") keeps the same
// data. Developers run the source tree with `-data examples/atlas-data`.
func defaultDataDir() string {
	if exe, err := os.Executable(); err == nil {
		exeDir := filepath.Dir(exe)
		portable := filepath.Join(exeDir, "atlas-data")
		if dirExists(portable) || dirWritable(exeDir) {
			return portable
		}
	}
	return userDataDir()
}

// userDataDir returns a deterministic per-user directory for Atlas data,
// suitable when the executable lives in a read-only location.
func userDataDir() string {
	switch runtime.GOOS {
	case "windows":
		if base := os.Getenv("LOCALAPPDATA"); base != "" {
			return filepath.Join(base, "YuAtlas", "atlas-data")
		}
		if home := os.Getenv("USERPROFILE"); home != "" {
			return filepath.Join(home, "AppData", "Local", "YuAtlas", "atlas-data")
		}
	case "darwin":
		if home := os.Getenv("HOME"); home != "" {
			return filepath.Join(home, "Library", "Application Support", "YuAtlas", "atlas-data")
		}
	default: // linux and other unix
		if xdg := os.Getenv("XDG_DATA_HOME"); xdg != "" {
			return filepath.Join(xdg, "yu-atlas", "atlas-data")
		}
		if home := os.Getenv("HOME"); home != "" {
			return filepath.Join(home, ".local", "share", "yu-atlas", "atlas-data")
		}
	}
	// Last resort (no home/env on an unusual system): current directory.
	return "atlas-data"
}

func dirExists(p string) bool {
	info, err := os.Stat(p)
	return err == nil && info.IsDir()
}

// dirWritable reports whether a new file can be created in dir (the directory
// itself must already exist).
func dirWritable(dir string) bool {
	probe := filepath.Join(dir, ".atlas-write-probe")
	if err := os.WriteFile(probe, []byte{0}, 0o644); err != nil {
		return false
	}
	_ = os.Remove(probe)
	return true
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
	// Not in Go's built-in MIME table; browsers want it for the PWA manifest.
	_ = mime.AddExtensionType(".webmanifest", "application/manifest+json")
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

// parseDNSServers turns "1.1.1.1, [2001:db8::1], 9.9.9.9:5353" into dialable
// host:port addresses (port 53 unless given).
func parseDNSServers(list string) []string {
	var out []string
	for _, s := range strings.Split(list, ",") {
		s = strings.TrimSpace(s)
		if s == "" {
			continue
		}
		if _, _, err := net.SplitHostPort(s); err != nil {
			s = net.JoinHostPort(strings.Trim(s, "[]"), "53")
		}
		out = append(out, s)
	}
	return out
}

// configureDNS points Go's resolver at explicit name servers. Android has no
// /etc/resolv.conf, so the pure-Go resolver would ask 127.0.0.1:53 and every
// lookup (place search) would fail; the Android app (apps/android) passes the
// active network's DNS servers in ATLAS_DNS. Each dial goes to the next
// server, so the resolver's retries walk the whole list.
func configureDNS(list string) {
	servers := parseDNSServers(list)
	if len(servers) == 0 {
		return
	}
	var next atomic.Uint32
	d := net.Dialer{Timeout: 3 * time.Second}
	net.DefaultResolver = &net.Resolver{
		PreferGo: true,
		Dial: func(ctx context.Context, network, _ string) (net.Conn, error) {
			i := int(next.Add(1)-1) % len(servers)
			return d.DialContext(ctx, network, servers[i])
		},
	}
	log.Printf("DNS servers: %s", strings.Join(servers, ", "))
}
