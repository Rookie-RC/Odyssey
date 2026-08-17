package geocode

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/yuatlas/runtime/internal/domain"
)

const photonBaseURL = "https://photon.komoot.io/"

// PhotonProvider is the zero-key default geocoding provider. It talks to the
// public Photon API and normalizes the GeoJSON response into Result values.
type PhotonProvider struct {
	client *http.Client
}

func NewPhotonProvider() *PhotonProvider {
	return &PhotonProvider{client: &http.Client{Timeout: 10 * time.Second}}
}

func (p *PhotonProvider) ID() string { return "photon" }

type photonResponse struct {
	Features []photonFeature `json:"features"`
}

type photonFeature struct {
	Geometry struct {
		Coordinates []float64 `json:"coordinates"`
	} `json:"geometry"`
	Properties struct {
		OSMType     string    `json:"osm_type"`
		OSMID       int64     `json:"osm_id"`
		OSMKey      string    `json:"osm_key"`
		OSMValue    string    `json:"osm_value"`
		Type        string    `json:"type"`
		Name        string    `json:"name"`
		City        string    `json:"city"`
		County      string    `json:"county"`
		State       string    `json:"state"`
		Country     string    `json:"country"`
		CountryCode string    `json:"countrycode"`
		Extent      []float64 `json:"extent"`
	} `json:"properties"`
}

func (p *PhotonProvider) Search(ctx context.Context, query string, opts SearchOptions) ([]Result, error) {
	limit := opts.Limit
	if limit <= 0 {
		limit = 8
	}
	// Over-fetch because Photon returns many POI/street results; we filter down
	// to destination-scale places after normalizing.
	requestLimit := limit * 6
	if requestLimit > 50 {
		requestLimit = 50
	}
	if requestLimit < 10 {
		requestLimit = 10
	}

	u, _ := url.Parse(photonBaseURL + "api/")
	q := u.Query()
	q.Set("q", query)
	q.Set("limit", strconv.Itoa(requestLimit))
	q.Set("lang", "en")
	u.RawQuery = q.Encode()

	resp, err := p.do(ctx, u.String())
	if err != nil {
		return nil, err
	}

	results := make([]Result, 0, limit)
	for _, f := range resp.Features {
		if res, ok := normalizeFeature(f); ok {
			results = append(results, res)
			if len(results) >= limit {
				break
			}
		}
	}
	return results, nil
}

func (p *PhotonProvider) Reverse(ctx context.Context, lat, lng float64) (*Result, error) {
	u, _ := url.Parse(photonBaseURL + "reverse")
	q := u.Query()
	q.Set("lat", strconv.FormatFloat(lat, 'f', 6, 64))
	q.Set("lon", strconv.FormatFloat(lng, 'f', 6, 64))
	q.Set("lang", "en")
	q.Set("limit", "15")
	u.RawQuery = q.Encode()

	resp, err := p.do(ctx, u.String())
	if err != nil {
		return nil, err
	}
	if len(resp.Features) == 0 {
		return nil, nil
	}
	for _, f := range resp.Features {
		if res, ok := normalizeFeature(f); ok {
			return &res, nil
		}
	}
	// Fall back to nearest-feature context (city / region / country) so manual
	// marker positioning still receives useful suggestions.
	if res, ok := contextResult(resp.Features[0], lat, lng); ok {
		return res, nil
	}
	return nil, nil
}

func (p *PhotonProvider) do(ctx context.Context, urlStr string) (*photonResponse, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, urlStr, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "yuatlas/0.1 (local personal travel atlas)")
	resp, err := p.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("photon returned status %d", resp.StatusCode)
	}
	var out photonResponse
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return nil, err
	}
	return &out, nil
}

func normalizeFeature(f photonFeature) (Result, bool) {
	pr := f.Properties
	st := suggestedType(pr.OSMKey, pr.OSMValue, pr.Type)
	if st == "" {
		return Result{}, false
	}
	if len(f.Geometry.Coordinates) < 2 {
		return Result{}, false
	}
	region := pr.State
	if region == "" {
		region = pr.City
	}
	if region == "" {
		region = pr.County
	}
	display := joinUnique(", ", pr.Name, region, pr.Country)
	return Result{
		Name:          pr.Name,
		DisplayName:   display,
		Country:       pr.Country,
		CountryCode:   pr.CountryCode,
		SuggestedType: st,
		Coordinates:   domain.Coordinates{Lat: f.Geometry.Coordinates[1], Lng: f.Geometry.Coordinates[0]},
		BBox:          pr.Extent,
		Provider:      "photon",
		ProviderID:    pr.OSMType + strconv.FormatInt(pr.OSMID, 10),
	}, true
}

// suggestedType maps a Photon feature to a Yu's Atlas Place type, or returns ""
// for results that are not destination-scale places (POIs, streets, countries).
// contextResult builds a contextual (non-place) suggestion from the nearest
// reverse-geocoded feature: city / region / country with the marker's own
// coordinates as the authoritative spatial value.
func contextResult(f photonFeature, lat, lng float64) (*Result, bool) {
	pr := f.Properties
	name := firstNonEmpty(pr.City, pr.State, pr.County, pr.Name)
	if name == "" {
		return nil, false
	}
	return &Result{
		Name:        name,
		DisplayName: joinUnique(", ", pr.City, pr.State, pr.Country),
		Country:     pr.Country,
		CountryCode: pr.CountryCode,
		Coordinates: domain.Coordinates{Lat: lat, Lng: lng},
		Provider:    "photon",
		ProviderID:  pr.OSMType + strconv.FormatInt(pr.OSMID, 10),
	}, true
}

func suggestedType(osmKey, osmValue, photonType string) domain.PlaceType {
	// Country-level results are not valid Places in V1.
	if osmValue == "country" || photonType == "country" {
		return ""
	}

	switch osmValue {
	case "city", "town", "village", "hamlet", "municipality", "borough",
		"suburb", "quarter", "neighbourhood", "locality", "isolated_dwelling":
		return domain.PlaceTypeCity
	case "state", "province", "county", "region", "district":
		return domain.PlaceTypeRegion
	case "island", "islet", "archipelago":
		return domain.PlaceTypeIsland
	case "peak", "volcano", "mountain_range", "valley", "bay", "fjord",
		"gulf", "strait", "peninsula", "cape", "glacier", "lake", "river",
		"waterfall", "canyon", "gorge", "national_park", "nature_reserve",
		"protected_area", "beach", "forest", "desert", "plateau", "dune",
		"wetland", "moor", "heath", "cliff", "cave", "reef":
		return domain.PlaceTypeNaturalArea
	}

	switch photonType {
	case "city":
		return domain.PlaceTypeCity
	case "state":
		return domain.PlaceTypeRegion
	case "island":
		return domain.PlaceTypeIsland
	}
	if osmKey == "natural" {
		return domain.PlaceTypeNaturalArea
	}
	return ""
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if v != "" {
			return v
		}
	}
	return ""
}

func joinUnique(sep string, vals ...string) string {
	seen := map[string]bool{}
	parts := make([]string, 0, len(vals))
	for _, v := range vals {
		v = strings.TrimSpace(v)
		if v == "" || seen[v] {
			continue
		}
		seen[v] = true
		parts = append(parts, v)
	}
	return strings.Join(parts, sep)
}
