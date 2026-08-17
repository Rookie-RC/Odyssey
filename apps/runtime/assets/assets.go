// Package assets embeds the built frontend (apps/web/out copied to
// assets/web by scripts/build.sh) into the runtime binary.
package assets

import (
	"embed"
	"io/fs"
)

//go:embed all:web
var webFS embed.FS

// FS returns the embedded frontend rooted at the web/ directory.
func FS() fs.FS {
	sub, err := fs.Sub(webFS, "web")
	if err != nil {
		panic(err)
	}
	return sub
}
