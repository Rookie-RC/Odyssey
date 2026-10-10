package storage

import (
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/yuatlas/runtime/internal/domain"
)

func newRepo(t *testing.T) (*Repository, string) {
	t.Helper()
	dir := t.TempDir()
	r := NewRepository(dir)
	if err := r.Ensure(); err != nil {
		t.Fatalf("ensure: %v", err)
	}
	return r, dir
}

// TestEnsureCreatesCollections: a fresh data dir gets every collection file,
// readable as empty values, and Ensure never overwrites existing data.
func TestEnsureCreatesCollections(t *testing.T) {
	r, dir := newRepo(t)
	for _, f := range []string{"profile.json", "places.json", "visits.json", "wishlist.json", "media.json", "settings.json"} {
		if _, err := os.Stat(filepath.Join(dir, "data", f)); err != nil {
			t.Errorf("%s not created: %v", f, err)
		}
	}
	places, err := r.LoadPlaces()
	if err != nil || len(places) != 0 {
		t.Fatalf("fresh places = %v, %v", places, err)
	}

	if err := r.SavePlaces([]domain.Place{{ID: "p1", Name: "Bordeaux", Type: domain.PlaceTypeCity}}); err != nil {
		t.Fatal(err)
	}
	if err := r.Ensure(); err != nil {
		t.Fatal(err)
	}
	if places, _ := r.LoadPlaces(); len(places) != 1 {
		t.Errorf("Ensure clobbered existing data: %v", places)
	}
}

// TestCollectionsRoundTrip saves and reloads every collection and checks the
// values survive unchanged (including nested/optional fields).
func TestCollectionsRoundTrip(t *testing.T) {
	r, dir := newRepo(t)

	places := []domain.Place{
		{ID: "p1", Name: "Bordeaux", Country: "France", CountryCode: "FR", Type: domain.PlaceTypeCity, Coordinates: domain.Coordinates{Lat: 44.84, Lng: -0.58}},
		{ID: "p2", Name: "Lofoten", Country: "Norway", CountryCode: "NO", Type: domain.PlaceTypeIsland, Coordinates: domain.Coordinates{Lat: 68.2, Lng: 13.6}},
	}
	visits := []domain.Visit{{
		ID: "v1", PlaceID: "p1", VisitType: domain.VisitTypeLived, StartDate: "2023-09", WithFriends: true,
		Highlights: []domain.VisitHighlight{{Name: "Place de la Bourse", Note: "at dusk"}},
		MediaIDs:   []string{"m1"}, Reflection: "home for a while",
	}}
	wishlist := []domain.Wishlist{{
		ID: "w1", PlaceID: "p2", Seasons: []domain.Season{domain.SeasonWinter}, Priority: 5,
		TargetTime:   &domain.TargetTime{Year: 2027, Season: domain.SeasonWinter},
		Inspirations: []domain.Inspiration{{Type: domain.InspirationPhoto, Title: "Reine"}},
	}}
	media := []domain.Media{{ID: "m1", Type: "image", Source: domain.MediaSourceLocal, Path: "/media/bordeaux/bourse.jpg", Caption: "Bourse"}}
	profile := domain.Profile{Name: "Yu", Bio: "travels slowly", Interests: []string{"islands"}}
	on := true
	settings := domain.Settings{Theme: "journal", ShowRoutes: true, ShowWishlist: &on, HideCountries: true}

	must := func(err error) {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
	}
	must(r.SavePlaces(places))
	must(r.SaveVisits(visits))
	must(r.SaveWishlist(wishlist))
	must(r.SaveMedia(media))
	must(r.SaveProfile(profile))
	must(r.SaveSettings(settings))

	// A second repository on the same directory proves the data is on disk,
	// not cached in memory.
	r2 := NewRepository(dir)
	gotPlaces, err := r2.LoadPlaces()
	must(err)
	gotVisits, err := r2.LoadVisits()
	must(err)
	gotWishlist, err := r2.LoadWishlist()
	must(err)
	gotMedia, err := r2.LoadMedia()
	must(err)
	gotProfile, err := r2.LoadProfile()
	must(err)
	gotSettings, err := r2.LoadSettings()
	must(err)

	for _, c := range []struct {
		name      string
		got, want any
	}{
		{"places", gotPlaces, places},
		{"visits", gotVisits, visits},
		{"wishlist", gotWishlist, wishlist},
		{"media", gotMedia, media},
		{"profile", gotProfile, profile},
		{"settings", gotSettings, settings},
	} {
		if !reflect.DeepEqual(c.got, c.want) {
			t.Errorf("%s round trip:\n got %+v\nwant %+v", c.name, c.got, c.want)
		}
	}

	// Update and delete are load-modify-save at the API level; check a
	// shrink is persisted too (no stale tail from the previous file).
	must(r.SavePlaces(places[:1]))
	if got, _ := r2.LoadPlaces(); len(got) != 1 || got[0].ID != "p1" {
		t.Errorf("after delete: %+v", got)
	}

	// Writes are atomic (temp + rename): no temp files are left behind.
	entries, _ := os.ReadDir(filepath.Join(dir, "data"))
	for _, e := range entries {
		if filepath.Ext(e.Name()) == ".tmp" {
			t.Errorf("temp file left behind: %s", e.Name())
		}
	}
}

// TestMediaFiles: files are stored under media/<folder>/, addressed by
// /media/... paths, and removal never escapes the media root.
func TestMediaFiles(t *testing.T) {
	r, dir := newRepo(t)
	rel, err := r.SaveMediaFile("bordeaux", "bourse.jpg", []byte("jpeg"))
	if err != nil {
		t.Fatal(err)
	}
	if rel != "/media/bordeaux/bourse.jpg" {
		t.Errorf("path = %q", rel)
	}
	if b, err := os.ReadFile(filepath.Join(dir, "media", "bordeaux", "bourse.jpg")); err != nil || string(b) != "jpeg" {
		t.Fatalf("file not stored: %v", err)
	}

	// A traversal attempt is ignored (and reported as success so cleanup
	// stays idempotent) — the protected file must survive.
	secret := filepath.Join(dir, "data", "places.json")
	if err := r.RemoveMediaFile("../data/places.json"); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(secret); err != nil {
		t.Fatalf("RemoveMediaFile escaped the media root: %v", err)
	}

	if err := r.RemoveMediaFile("bordeaux/bourse.jpg"); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(dir, "media", "bordeaux", "bourse.jpg")); !os.IsNotExist(err) {
		t.Errorf("file not removed: %v", err)
	}
	if err := r.RemoveMediaFile("bordeaux/bourse.jpg"); err != nil {
		t.Errorf("second removal should be a no-op: %v", err)
	}
}
