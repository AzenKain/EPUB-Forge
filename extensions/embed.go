package extensions

import "embed"

// FS contains the built-in store extensions bundled into the native binary.
//
//go:embed origin/*.js
var FS embed.FS
