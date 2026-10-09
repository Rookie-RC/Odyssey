// Package lan implements optional "Share on local network" mode
// (PRODUCT_SPEC §4).
//
// The runtime always listens on 127.0.0.1:PORT. While LAN sharing is on, the
// Manager additionally listens on every private IPv4 address of this computer
// on the SAME port (binding 192.168.1.23:4317 never conflicts with
// 127.0.0.1:4317 — they are different local addresses), so a phone on the
// same Wi-Fi can open http://192.168.1.23:4317.
//
// The extra listeners serve the very same handler as the loopback one; what
// makes them read-only is not this package but the access rules in
// internal/api (a request accepted on a non-loopback address is "remote" and
// may only read). Keeping the listeners dumb means there is exactly one place
// that decides what a LAN guest may do.
//
// LAN listeners get their own http.Server, separate from the main one, so
// sharing can be switched off live — closing only the LAN listeners and
// draining their in-flight requests — without touching the loopback server
// the owner's browser is using.
package lan

import (
	"context"
	"errors"
	"log"
	"net"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Status is the LAN-sharing state reported by GET /api/runtime ("lan").
type Status struct {
	// Enabled reports whether sharing is switched on (by the lanSharing
	// setting or the -lan flag) — the requested state, even if no listener
	// could be bound (see Error).
	Enabled bool `json:"enabled"`
	// URLs are the addresses actually being served, e.g.
	// "http://192.168.1.23:4317". Always a JSON array, never null.
	URLs []string `json:"urls"`
	// Error describes why some or all addresses could not be served (no
	// network, port taken on that interface, …). Empty when all is well.
	Error string `json:"error,omitempty"`
}

// Manager owns the LAN listeners. It is safe for concurrent use.
type Manager struct {
	port    int
	handler http.Handler
	// addrs lists the addresses to bind; PrivateIPv4Addrs in production,
	// replaceable in tests.
	addrs func() ([]net.IP, error)

	mu        sync.Mutex
	enabled   bool
	srv       *http.Server
	listeners []net.Listener
	urls      []string
	lastErr   string
}

// NewManager returns a Manager that will serve handler on port for every
// private IPv4 address of this computer once enabled. Sharing starts off.
func NewManager(port int, handler http.Handler) *Manager {
	return &Manager{port: port, handler: handler, addrs: PrivateIPv4Addrs}
}

// Status returns a snapshot of the current state.
func (m *Manager) Status() Status {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.statusLocked()
}

func (m *Manager) statusLocked() Status {
	urls := make([]string, len(m.urls))
	copy(urls, m.urls)
	return Status{Enabled: m.enabled, URLs: urls, Error: m.lastErr}
}

// SetEnabled switches sharing on or off and returns the resulting state.
//
// Turning it on while it is already serving is a no-op; turning it on while
// it is enabled but serving nothing (e.g. the computer was offline at
// startup) retries the bind, so toggling the setting is also the way to pick
// up a new network. Bind failures never panic or stop the runtime: they are
// recorded in Status.Error and logged.
//
// Turning it off closes the LAN listeners immediately (so the port is free
// for a quick re-enable) and drains in-flight LAN requests in the background
// via http.Server.Shutdown.
func (m *Manager) SetEnabled(on bool) Status {
	m.mu.Lock()
	var stopped *http.Server
	if on {
		m.startLocked()
	} else {
		stopped = m.stopLocked()
	}
	st := m.statusLocked()
	m.mu.Unlock()

	if stopped != nil {
		go drain(stopped, 5*time.Second)
		log.Printf("LAN sharing off")
	}
	return st
}

// Shutdown stops sharing and waits (up to ctx) for in-flight LAN requests to
// finish. Used on process exit.
func (m *Manager) Shutdown(ctx context.Context) error {
	m.mu.Lock()
	srv := m.stopLocked()
	m.mu.Unlock()
	if srv == nil {
		return nil
	}
	return srv.Shutdown(ctx)
}

func (m *Manager) startLocked() {
	m.enabled = true
	if m.srv != nil {
		return // already serving
	}
	m.lastErr = ""
	ips, err := m.addrs()
	if err != nil {
		m.lastErr = "cannot list network interfaces: " + err.Error()
		log.Printf("LAN sharing: %s", m.lastErr)
		return
	}
	if len(ips) == 0 {
		m.lastErr = "no local network address found (is this computer connected to a Wi-Fi or Ethernet network?)"
		log.Printf("LAN sharing: %s", m.lastErr)
		return
	}

	// ReadHeaderTimeout: these listeners face the network, so a client that
	// opens a connection and never finishes its headers must not hold it
	// forever.
	srv := &http.Server{Handler: m.handler, ReadHeaderTimeout: 10 * time.Second}
	var failures []string
	for _, ip := range ips {
		addr := net.JoinHostPort(ip.String(), strconv.Itoa(m.port))
		ln, err := net.Listen("tcp4", addr)
		if err != nil {
			failures = append(failures, err.Error())
			continue
		}
		m.listeners = append(m.listeners, ln)
		m.urls = append(m.urls, "http://"+ln.Addr().String())
		go m.serve(srv, ln)
	}
	if len(m.listeners) > 0 {
		m.srv = srv
		log.Printf("LAN sharing on (read-only): %s", strings.Join(m.urls, ", "))
	}
	if len(failures) > 0 {
		m.lastErr = strings.Join(failures, "; ") // e.g. "listen tcp4 192.168.1.23:4317: bind: address already in use"
		log.Printf("LAN sharing: %s", m.lastErr)
	}
}

// stopLocked marks sharing off, closes the listeners and returns the server
// that still has to be drained (nil when nothing was running).
func (m *Manager) stopLocked() *http.Server {
	m.enabled = false
	srv := m.srv
	for _, ln := range m.listeners {
		_ = ln.Close()
	}
	m.srv, m.listeners, m.urls, m.lastErr = nil, nil, nil, ""
	return srv
}

func (m *Manager) serve(srv *http.Server, ln net.Listener) {
	err := srv.Serve(ln)
	if err == nil || errors.Is(err, http.ErrServerClosed) || errors.Is(err, net.ErrClosed) {
		return // normal stop
	}
	log.Printf("LAN sharing on %s stopped: %v", ln.Addr(), err)
	m.mu.Lock()
	if m.srv == srv {
		m.lastErr = "listener " + ln.Addr().String() + " failed: " + err.Error()
	}
	m.mu.Unlock()
}

// drain gracefully shuts a stopped LAN server down: in-flight requests may
// finish, idle keep-alive connections are closed. After the timeout the
// remaining connections are cut.
func drain(srv *http.Server, timeout time.Duration) {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil {
		_ = srv.Close()
	}
}

// PrivateIPv4Addrs returns the addresses LAN sharing binds: the private
// (RFC 1918: 10/8, 172.16/12, 192.168/16) IPv4 addresses of every interface
// that is up. Excluded:
//
//   - loopback (already served by the main listener);
//   - link-local 169.254/16 (self-assigned when there is no real network);
//   - point-to-point interfaces (VPN tunnels — not "the local network");
//   - IPv6 (LAN URLs are meant to be typed or scanned; keep them short).
//
// The result is ordered so the most likely home-network address
// (192.168.x.y, then 10.x, then 172.16–31.x — which is also where virtual
// switches such as Docker or WSL usually live) comes first.
func PrivateIPv4Addrs() ([]net.IP, error) {
	ifaces, err := net.Interfaces()
	if err != nil {
		return nil, err
	}
	var out []net.IP
	seen := map[string]bool{}
	for _, iface := range ifaces {
		if iface.Flags&net.FlagUp == 0 || iface.Flags&net.FlagLoopback != 0 || iface.Flags&net.FlagPointToPoint != 0 {
			continue
		}
		addrs, err := iface.Addrs()
		if err != nil {
			continue
		}
		for _, a := range addrs {
			ipnet, ok := a.(*net.IPNet)
			if !ok || !Shareable(ipnet.IP) {
				continue
			}
			ip := ipnet.IP.To4()
			if key := ip.String(); !seen[key] {
				seen[key] = true
				out = append(out, ip)
			}
		}
	}
	sort.SliceStable(out, func(i, j int) bool { return rank(out[i]) < rank(out[j]) })
	return out, nil
}

// Shareable reports whether ip is an address LAN sharing may bind: a private
// (RFC 1918) IPv4 address that is neither loopback nor link-local.
func Shareable(ip net.IP) bool {
	ip4 := ip.To4()
	return ip4 != nil && ip4.IsPrivate() && !ip4.IsLoopback() && !ip4.IsLinkLocalUnicast()
}

func rank(ip net.IP) int {
	ip4 := ip.To4()
	switch {
	case ip4[0] == 192:
		return 0
	case ip4[0] == 10:
		return 1
	default:
		return 2
	}
}
