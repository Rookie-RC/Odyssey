// Command atlas runs the Odyssey runtime: it serves the embedded frontend,
// exposes the JSON API over the atlas-data directory and proxies/normalizes
// geocoding requests. The Android app runs it on the phone (127.0.0.1 only);
// -mode cloud serves many accounts as a website.
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
	"os/signal"
	"path/filepath"
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
		dataDir  = flag.String("data", "", "path to the atlas-data directory (required; or set YUATLAS_DATA)")
		port     = flag.Int("port", 4317, "preferred HTTP port (falls back to a free port)")
		host     = flag.String("host", "127.0.0.1", "bind address")
		readonly = flag.Bool("readonly", false, "serve read-only: reject all API writes and report writable=false")

		mode         = flag.String("mode", "local", "local: one Atlas on this device; cloud: multi-user web service (accounts, one Atlas per user)")
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

	// Graceful shutdown on Ctrl-C.
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	<-stop
	log.Println("shutting down")
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = httpServer.Shutdown(ctx)
}

// resolveDataDir returns the absolute path of the atlas-data directory: the
// -data flag, else the YUATLAS_DATA environment variable. There is no default
// location: the phone app always passes its private directory, and on a
// computer the runtime is only run for development (with -data
// examples/atlas-data) or as the cloud-mode server.
//
// The result is always absolute, so the effective location never depends on
// the process working directory; it is reported by GET /api/runtime, which
// the Android app uses to recognise a runtime it started earlier.
func resolveDataDir(explicit string) (string, error) {
	dir := explicit
	if dir == "" {
		dir = os.Getenv("YUATLAS_DATA")
	}
	if dir == "" {
		return "", fmt.Errorf("no data directory: pass -data <dir> (or set YUATLAS_DATA)")
	}
	abs, err := filepath.Abs(dir)
	if err != nil {
		return "", err
	}
	return filepath.Clean(abs), nil
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
