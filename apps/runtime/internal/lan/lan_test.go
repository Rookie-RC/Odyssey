package lan

import (
	"context"
	"errors"
	"io"
	"net"
	"net/http"
	"strings"
	"testing"
	"time"
)

var hello = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { _, _ = io.WriteString(w, "atlas") })

// testManager binds the given addresses instead of the real interfaces;
// port 0 lets each listener pick a free port (the URL reports the real one).
func testManager(port int, ips ...string) *Manager {
	m := NewManager(port, hello)
	m.addrs = func() ([]net.IP, error) {
		var out []net.IP
		for _, s := range ips {
			out = append(out, net.ParseIP(s))
		}
		return out, nil
	}
	return m
}

func fetch(url string) (string, error) {
	c := &http.Client{Timeout: 2 * time.Second}
	resp, err := c.Get(url)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	b, err := io.ReadAll(resp.Body)
	return string(b), err
}

func TestManagerLifecycle(t *testing.T) {
	m := testManager(0, "127.0.0.1")
	if st := m.Status(); st.Enabled || st.URLs == nil || len(st.URLs) != 0 {
		t.Fatalf("initial status = %+v", st)
	}

	st := m.SetEnabled(true)
	if !st.Enabled || len(st.URLs) != 1 || st.Error != "" || !strings.HasPrefix(st.URLs[0], "http://127.0.0.1:") {
		t.Fatalf("enabled status = %+v", st)
	}
	url := st.URLs[0]
	if body, err := fetch(url); err != nil || body != "atlas" {
		t.Fatalf("GET %s = %q, %v", url, body, err)
	}

	// Enabling again while serving is a no-op (same listener).
	if st2 := m.SetEnabled(true); len(st2.URLs) != 1 || st2.URLs[0] != url {
		t.Fatalf("re-enable changed listeners: %+v", st2)
	}

	st = m.SetEnabled(false)
	if st.Enabled || len(st.URLs) != 0 || st.URLs == nil {
		t.Fatalf("disabled status = %+v", st)
	}
	// The listener is closed synchronously.
	if _, err := fetch(url); err == nil {
		t.Fatal("LAN listener still serving after disable")
	}

	// And sharing can be switched on again.
	if st := m.SetEnabled(true); len(st.URLs) != 1 {
		t.Fatalf("re-enable after disable = %+v", st)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	if err := m.Shutdown(ctx); err != nil {
		t.Fatal(err)
	}
	if st := m.Status(); st.Enabled || len(st.URLs) != 0 {
		t.Fatalf("after shutdown = %+v", st)
	}
}

// TestManagerBindFailures: failures are recorded, never fatal; one bad
// address does not stop the others.
func TestManagerBindFailures(t *testing.T) {
	// Occupy a port, then ask the manager for the same address and port.
	busy, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer busy.Close()
	port := busy.Addr().(*net.TCPAddr).Port

	m := testManager(port, "127.0.0.1")
	st := m.SetEnabled(true)
	if !st.Enabled || len(st.URLs) != 0 || st.Error == "" {
		t.Fatalf("busy port: %+v", st)
	}

	// 192.0.2.1 (TEST-NET-1) is not an address of this machine; the
	// loopback one still works.
	m = testManager(0, "192.0.2.1", "127.0.0.1")
	st = m.SetEnabled(true)
	if len(st.URLs) != 1 || !strings.Contains(st.Error, "192.0.2.1") {
		t.Fatalf("partial failure: %+v", st)
	}
	m.SetEnabled(false)

	// No addresses at all / enumeration error.
	m = testManager(0)
	if st := m.SetEnabled(true); !st.Enabled || st.Error == "" || len(st.URLs) != 0 {
		t.Fatalf("no addresses: %+v", st)
	}
	m.addrs = func() ([]net.IP, error) { return nil, errors.New("boom") }
	m.SetEnabled(false)
	if st := m.SetEnabled(true); !strings.Contains(st.Error, "boom") {
		t.Fatalf("enumeration error: %+v", st)
	}
	// Disabling clears the error.
	if st := m.SetEnabled(false); st.Error != "" {
		t.Fatalf("error kept after disable: %+v", st)
	}
}

func TestShareable(t *testing.T) {
	for ip, want := range map[string]bool{
		"192.168.1.23": true,
		"10.0.0.5":     true,
		"172.16.4.2":   true,
		"172.31.255.1": true,
		"127.0.0.1":    false, // loopback: the main listener
		"169.254.10.1": false, // link-local
		"172.32.0.1":   false, // public
		"8.8.8.8":      false,
		"100.64.0.1":   false, // CGNAT, not RFC 1918
		"fd00::1":      false, // IPv6 ULA: IPv4 only
		"::1":          false,
	} {
		if got := Shareable(net.ParseIP(ip)); got != want {
			t.Errorf("Shareable(%s) = %v, want %v", ip, got, want)
		}
	}
}

// TestPrivateIPv4Addrs only checks the invariants: whatever this machine
// has, every returned address is shareable and they are ordered.
func TestPrivateIPv4Addrs(t *testing.T) {
	ips, err := PrivateIPv4Addrs()
	if err != nil {
		t.Skipf("cannot list interfaces here: %v", err)
	}
	for i, ip := range ips {
		if !Shareable(ip) {
			t.Errorf("%s is not shareable", ip)
		}
		if i > 0 && rank(ips[i-1]) > rank(ip) {
			t.Errorf("not ordered: %v", ips)
		}
	}
}
