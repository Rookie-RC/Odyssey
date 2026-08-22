// Package domain holds the core Yu's Atlas domain model. It is independent of
// the filesystem implementation and mirrors the TypeScript types in
// apps/web/src/lib/types.ts.
//
// Countries are metadata (Country / CountryCode) on a Place; they are not
// first-class Place records and never receive map pins.
package domain

type PlaceType string

const (
	PlaceTypeCity        PlaceType = "city"
	PlaceTypeRegion      PlaceType = "region"
	PlaceTypeIsland      PlaceType = "island"
	PlaceTypeNaturalArea PlaceType = "natural_area"
)

// ValidPlaceType reports whether t is one of the allowed Place types. Country
// ("country") is intentionally not a valid Place type.
func ValidPlaceType(t string) bool {
	switch PlaceType(t) {
	case PlaceTypeCity, PlaceTypeRegion, PlaceTypeIsland, PlaceTypeNaturalArea:
		return true
	default:
		return false
	}
}

type Coordinates struct {
	Lat float64 `json:"lat"`
	Lng float64 `json:"lng"`
}

type Place struct {
	ID          string      `json:"id"`
	Name        string      `json:"name"`
	Country     string      `json:"country"`
	CountryCode string      `json:"countryCode"`
	Type        PlaceType   `json:"type"`
	Coordinates Coordinates `json:"coordinates"`
}

type VisitType string

const (
	VisitTypeLived    VisitType = "lived"
	VisitTypeTrip     VisitType = "trip"
	VisitTypeDayTrip  VisitType = "day_trip"
	VisitTypeStopover VisitType = "stopover"
	VisitTypeTransit  VisitType = "transit"
)

func ValidVisitType(t string) bool {
	switch VisitType(t) {
	case VisitTypeLived, VisitTypeTrip, VisitTypeDayTrip, VisitTypeStopover, VisitTypeTransit:
		return true
	default:
		return false
	}
}

type VisitHighlight struct {
	Name string `json:"name"`
	Note string `json:"note,omitempty"`
}

type Visit struct {
	ID          string           `json:"id"`
	PlaceID     string           `json:"placeId"`
	VisitType   VisitType        `json:"visitType"`
	StartDate   string           `json:"startDate,omitempty"`
	EndDate     string           `json:"endDate,omitempty"`
	WithFriends bool             `json:"withFriends,omitempty"`
	Highlights  []VisitHighlight `json:"highlights,omitempty"`
	MediaIDs    []string         `json:"mediaIds,omitempty"`
	Reflection  string           `json:"reflection,omitempty"`
}

type Season string

const (
	SeasonSpring Season = "spring"
	SeasonSummer Season = "summer"
	SeasonAutumn Season = "autumn"
	SeasonWinter Season = "winter"
)

type InspirationType string

const (
	InspirationBook        InspirationType = "book"
	InspirationMovie       InspirationType = "movie"
	InspirationVideo       InspirationType = "video"
	InspirationSocialMedia InspirationType = "social_media"
	InspirationArticle     InspirationType = "article"
	InspirationFriend      InspirationType = "friend"
	InspirationPhoto       InspirationType = "photo"
	InspirationMusic       InspirationType = "music"
	InspirationOther       InspirationType = "other"
)

type Inspiration struct {
	Type     InspirationType `json:"type"`
	Title    string          `json:"title,omitempty"`
	Creator  string          `json:"creator,omitempty"`
	Platform string          `json:"platform,omitempty"`
	URL      string          `json:"url,omitempty"`
	Note     string          `json:"note,omitempty"`
}

type TargetTime struct {
	Year   int    `json:"year,omitempty"`
	Season Season `json:"season,omitempty"`
}

type Wishlist struct {
	ID           string        `json:"id"`
	PlaceID      string        `json:"placeId"`
	Seasons      []Season      `json:"seasons,omitempty"`
	TargetTime   *TargetTime   `json:"targetTime,omitempty"`
	Priority     int           `json:"priority,omitempty"`
	Why          string        `json:"why,omitempty"`
	Inspirations []Inspiration `json:"inspirations,omitempty"`
	MediaIDs     []string      `json:"mediaIds,omitempty"`
	Note         string        `json:"note,omitempty"`
}

type MediaSource string

const (
	MediaSourceLocal MediaSource = "local"
	MediaSourceWeb   MediaSource = "web"
)

type Media struct {
	ID        string      `json:"id"`
	Type      string      `json:"type"` // "image"
	Source    MediaSource `json:"source"`
	Path      string      `json:"path"`
	Caption   string      `json:"caption,omitempty"`
	SourceURL string      `json:"sourceUrl,omitempty"`
	Author    string      `json:"author,omitempty"`
	License   string      `json:"license,omitempty"`
}

type Profile struct {
	Name        string `json:"name"`
	Avatar      string `json:"avatar,omitempty"`
	CurrentBase *struct {
		PlaceID string `json:"placeId"`
	} `json:"currentBase,omitempty"`
	Bio       string   `json:"bio,omitempty"`
	Interests []string `json:"interests,omitempty"`
	Links     []struct {
		Label string `json:"label"`
		URL   string `json:"url"`
	} `json:"links,omitempty"`
}

type Settings struct {
	Theme              string       `json:"theme,omitempty"`
	GeocodingProvider  string       `json:"geocodingProvider,omitempty"`
	DefaultMapPosition *Coordinates `json:"defaultMapPosition,omitempty"`
	LANSharing         bool         `json:"lanSharing,omitempty"`
	ShowRoutes         bool         `json:"showRoutes,omitempty"`
}
