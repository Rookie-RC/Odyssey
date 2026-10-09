package api

// Access control for the runtime's HTTP surface (PRODUCT_SPEC §4, §43).
//
// The runtime can be reached in three ways, and each gets a different answer:
//
//  1. From this computer, over the loopback listener (127.0.0.1:PORT). This is
//     the owner: full read/write access (unless the whole runtime was started
//     with -readonly).
//  2. From another device on the local network, over the optional LAN
//     listeners (192.168.x.y:PORT, only while LAN sharing is on). This is a
//     guest: it may look at the Atlas (frontend, /media, read-only API) and
//     nothing else — "editing must only be available from localhost".
//  3. Indirectly, by a web page open in the owner's own browser that aims
//     requests at the loopback port: cross-site request forgery (a form or a
//     no-cors fetch POSTing to http://127.0.0.1:4317/api/...) or DNS
//     rebinding (a page on http://evil.example:4317 whose name is re-pointed
//     at 127.0.0.1, which makes the browser treat our responses as
//     same-origin with the attacker). This is an attacker and must get
//     nothing: no reads, no writes.
//
// Protect (the outermost middleware, wrapped around /api, /media and the
// static frontend in main) enforces all three; Server.Handler repeats the
// remote/read-only gate for the API so the API can never be mounted without
// it. The individual rules and the reasoning behind them are documented on
// each helper below.

import (
	"net"
	"net/http"
	"net/url"
	"strings"
)

// remoteReadOnlyMsg is the error every write (and every editing-only
// endpoint) returns to a LAN client. The frontend can show it verbatim.
const remoteReadOnlyMsg = "read-only: editing is only available on this computer"

// IsRemote reports whether r did NOT arrive over loopback, i.e. it came from
// another device through a LAN listener (or any non-loopback bind).
//
// Both ends of the connection are checked:
//
//   - the local address the connection was accepted on
//     (http.LocalAddrContextKey, set by net/http for every real connection):
//     a request accepted by a 192.168.x.y listener is remote even if its
//     peer address looks local — e.g. this same computer opening the LAN URL
//     is deliberately treated like any other LAN viewer, so "remote" always
//     means "came in through the sharing listener";
//   - the peer address (r.RemoteAddr): a request is only local when the
//     peer is loopback too.
//
// Anything unparseable counts as remote (fail closed). When the local address
// is missing (only possible for synthetic requests, e.g. unit tests calling a
// handler directly) the decision rests on RemoteAddr alone.
func IsRemote(r *http.Request) bool {
	if la, ok := r.Context().Value(http.LocalAddrContextKey).(net.Addr); ok && la != nil {
		if !addrIsLoopback(la) {
			return true
		}
	}
	return !hostPortIsLoopback(r.RemoteAddr)
}

func addrIsLoopback(a net.Addr) bool {
	if tcp, ok := a.(*net.TCPAddr); ok {
		return tcp.IP.IsLoopback()
	}
	return hostPortIsLoopback(a.String())
}

// hostPortIsLoopback parses "host:port" (or a bare host) and reports whether
// host is a loopback IP literal (127.0.0.0/8, ::1, or ::ffff:127.x.y.z).
func hostPortIsLoopback(hostport string) bool {
	host := hostport
	if h, _, err := net.SplitHostPort(hostport); err == nil {
		host = h
	}
	if i := strings.IndexByte(host, '%'); i >= 0 { // strip an IPv6 zone
		host = host[:i]
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

// isWriteMethod reports whether a method can change state. GET and HEAD are
// reads; OPTIONS is a CORS preflight that never reaches a handler.
func isWriteMethod(method string) bool {
	switch method {
	case http.MethodGet, http.MethodHead, http.MethodOptions:
		return false
	}
	return true
}

// remoteAllowed is the whole LAN policy: a remote client may only GET/HEAD,
// and never the editing-only endpoints even with GET —
//
//   - /api/geocode/* proxies searches to an online provider on the owner's
//     behalf (rate limits, the owner's network identity) and only exists to
//     support adding places;
//   - /api/atlas/* is packaging/backups (export, import, restore, list).
//
// Everything else that answers GET (the frontend, /media/*, /api/places …)
// is exactly what a read-only viewer needs.
func remoteAllowed(r *http.Request) bool {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		return false
	}
	p := r.URL.Path
	for _, prefix := range []string{"/api/geocode", "/api/atlas"} {
		if p == prefix || strings.HasPrefix(p, prefix+"/") {
			return false
		}
	}
	return true
}

// allowedHost is the DNS-rebinding defence. In a rebinding attack the
// browser's URL — and therefore the Host header — carries the attacker's DNS
// name (Host: evil.example:4317) even though the TCP connection lands on our
// loopback port; the browser considers our responses same-origin with the
// attacker's page, so CORS offers no protection. Rejecting unknown Host
// names closes that hole.
//
// Accepted:
//
//   - "localhost" (any port): browsers resolve it to loopback themselves and
//     never ask DNS, so an attacker cannot rebind it. Covers the Next.js dev
//     proxy as well (it forwards either localhost:3000 or 127.0.0.1:4317).
//   - any IP literal (any port): 127.0.0.1, [::1], and — for LAN sharing —
//     the LAN address a guest typed or scanned, e.g. 192.168.1.23:4317. An
//     IP literal cannot be rebound: if the Host is an IP, the page's origin
//     *is* that IP, so the page was served by us (or by nobody). This is
//     what lets legitimate LAN GETs through while still blocking names.
//   - an empty Host (HTTP/1.0 clients such as scripts): browsers always send
//     Host, so this can never be a browser-driven attack.
//
// Rejected: every other name. That includes this computer's own hostname or
// mDNS name (my-pc.local) — the runtime advertises LAN URLs by IP, so that is
// a deliberate, documented limitation rather than a hole worth opening.
func allowedHost(hostport string) bool {
	if hostport == "" {
		return true
	}
	host := hostport
	if h, _, err := net.SplitHostPort(hostport); err == nil {
		host = h
	} else {
		// No port: "localhost", "127.0.0.1", "[::1]" or a bare "::1".
		host = strings.TrimSuffix(strings.TrimPrefix(host, "["), "]")
	}
	if strings.EqualFold(host, "localhost") {
		return true
	}
	return net.ParseIP(host) != nil
}

// isLoopbackOrigin reports whether origin is http(s)://127.0.0.1[:port],
// http(s)://localhost[:port], or http(s)://[::1][:port] — the only origins a
// legitimate local Atlas client (the app itself or the Next.js dev server)
// can have. "null" (sandboxed iframes, file://) and malformed values are not.
func isLoopbackOrigin(origin string) bool {
	u, err := url.Parse(origin)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") {
		return false
	}
	host := u.Hostname()
	if strings.EqualFold(host, "localhost") {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

// Protect wraps the runtime's whole HTTP surface (API, /media, frontend) in
// the access rules above. Order matters:
//
//  1. Host check, for every request — a rebinding attacker must not even
//     read the frontend or the user's photos.
//  2. Remote (LAN) requests: GET/HEAD of viewer-safe paths only; everything
//     else gets 403 {"error": remoteReadOnlyMsg}. No CORS headers are ever
//     sent to remote clients: the LAN app is served same-origin by this
//     runtime, so they never need any.
//  3. Local requests:
//     - CORS: reflect only a loopback Origin. This exists solely for the
//     Next.js dev server calling the API cross-origin; a wildcard would let
//     any web page read Atlas data.
//     - CSRF: a state-changing request carrying a non-loopback Origin is
//     refused. CORS alone does not stop "simple" cross-site requests (a
//     form POST, a no-cors fetch with text/plain) from executing — the
//     attacker merely cannot read the response, but the write (or a
//     POST /api/atlas/new!) would already have happened. Browsers always
//     send Origin on cross-origin requests and on every non-GET/HEAD
//     request, so the absence of Origin means a non-browser client
//     (curl, scripts), which is fine. This also refuses writes relayed by
//     the Next.js dev proxy from a page opened via a LAN address
//     (Origin http://192.168.x.y:3000), keeping editing local in dev too.
func Protect(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !allowedHost(r.Host) {
			writeError(w, http.StatusForbidden, "forbidden: unrecognized Host header")
			return
		}

		if IsRemote(r) {
			if !remoteAllowed(r) {
				writeError(w, http.StatusForbidden, remoteReadOnlyMsg)
				return
			}
			next.ServeHTTP(w, r)
			return
		}

		origin := r.Header.Get("Origin")
		loopbackOrigin := origin != "" && isLoopbackOrigin(origin)
		if loopbackOrigin {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Add("Vary", "Origin")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		}
		if r.Method == http.MethodOptions {
			// Preflight: without Allow-Origin above the browser blocks the
			// real request itself; nothing to do here.
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if isWriteMethod(r.Method) && origin != "" && !loopbackOrigin {
			writeError(w, http.StatusForbidden, "forbidden: cross-origin write rejected")
			return
		}
		next.ServeHTTP(w, r)
	})
}
