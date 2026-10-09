package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"github.com/yuatlas/runtime/internal/cloud"
	"github.com/yuatlas/runtime/internal/config"
	"github.com/yuatlas/runtime/internal/geocode"
)

type cloudOptions struct {
	dataDir      string
	host         string
	port         int
	publicOrigin string
	allowSignup  bool
	quotaMB      int64
	trustProxy   bool
}

// runCloud serves the multi-user web service (internal/cloud): the same
// embedded frontend, with accounts and one Atlas per user under
// <data>/users/<id>/. Unlike local mode it never opens a browser, never
// starts LAN listeners and never falls back to another port (a reverse
// proxy points at a fixed one). See docs/DEPLOY.md.
func runCloud(o cloudOptions) {
	root := o.dataDir
	if root == "" {
		root = os.Getenv("YUATLAS_DATA")
	}
	if root == "" {
		log.Fatal("cloud mode needs -data (or YUATLAS_DATA): the directory that holds every user's atlas")
	}
	root, err := filepath.Abs(root)
	if err != nil {
		log.Fatalf("resolve data directory: %v", err)
	}
	if err := os.MkdirAll(root, 0o755); err != nil {
		log.Fatalf("create data directory: %v", err)
	}

	origins, err := cloud.ParseOrigins(o.publicOrigin)
	if err != nil {
		log.Fatalf("-public-origin: %v", err)
	}
	if len(origins) == 0 {
		origins = []string{
			fmt.Sprintf("http://localhost:%d", o.port),
			fmt.Sprintf("http://127.0.0.1:%d", o.port),
		}
		log.Printf("warning: no -public-origin given; accepting only %v", origins)
	}

	cfg := config.Load(root)
	svc, err := cloud.New(cloud.Config{
		Root:        root,
		Origins:     origins,
		AllowSignup: o.allowSignup,
		QuotaBytes:  o.quotaMB << 20,
		TrustProxy:  o.trustProxy,
		Geocoder:    geocode.NewManager(selectProvider(cfg)),
		Static:      staticHandler(),
	})
	if err != nil {
		log.Fatalf("start cloud service: %v", err)
	}

	addr := net.JoinHostPort(o.host, fmt.Sprint(o.port))
	httpServer := &http.Server{
		Addr:              addr,
		Handler:           svc.Handler(),
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       120 * time.Second,
	}
	go func() {
		log.Printf("Odyssey cloud service listening on http://%s", addr)
		log.Printf("data root: %s (%d accounts)", root, svc.Users().Count())
		log.Printf("public origins: %v; sign-up %s; quota %d MB per user", origins, map[bool]string{true: "open", false: "closed"}[o.allowSignup], o.quotaMB)
		if err := httpServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("server error: %v", err)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	<-stop
	log.Println("shutting down")
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	_ = httpServer.Shutdown(ctx)
}
