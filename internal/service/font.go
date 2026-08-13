package service

import (
	"fmt"
	"path"
	"path/filepath"
	"regexp"
	"strings"
)

func (s *Service) EmbedFont(id string, fontName string, fontFileName string, fontBytes []byte) (BookAnalysis, error) {
	lock := s.getBookLock(id)
	lock.Lock()
	defer lock.Unlock()

	ctx, err := loadBook(id)
	if err != nil {
		return BookAnalysis{}, err
	}
	defer ctx.Close()

	fontFamily := strings.TrimSpace(fontName)
	if fontFamily == "" {
		fontFamily = "CustomFont"
	}

	fontExt := filepath.Ext(fontFileName)
	if fontExt == "" {
		fontExt = ".ttf"
	}
	fontHref := "Fonts/" + sanitizeFileName(fontFamily) + fontExt
	fontZipPath := ctx.OPFDir + fontHref

	mediaType := "font/ttf"
	switch strings.ToLower(fontExt) {
	case ".otf":
		mediaType = "application/vnd.ms-opentype"
	case ".woff":
		mediaType = "font/woff"
	case ".woff2":
		mediaType = "font/woff2"
	}

	editedFiles := map[string][]byte{}

	editedFiles[fontZipPath] = fontBytes

	opfXML, err := ctx.readText(ctx.OPFPath)
	if err != nil {
		return BookAnalysis{}, err
	}

	escapedHref := regexp.QuoteMeta(fontHref)
	hasFontInOPF := regexp.MustCompile(`(?i)href\s*=\s*["']` + escapedHref + `["']`).MatchString(opfXML)
	if !hasFontInOPF {
		manifestMatch := manifestRe.FindStringSubmatch(opfXML)
		if len(manifestMatch) >= 4 {
			manifestHeader := manifestMatch[1]
			manifestBody := manifestMatch[2]
			manifestFooter := manifestMatch[3]

			fontItemID := "font_" + sanitizeFileName(fontFamily)
			itemTag := fmt.Sprintf(`<item id="%s" href="%s" media-type="%s"/>`, fontItemID, fontHref, mediaType)

			newManifestBody := "\n    " + itemTag + manifestBody
			opfXML = strings.Replace(opfXML, manifestMatch[0], manifestHeader+newManifestBody+manifestFooter, 1)
		}
	}
	editedFiles[ctx.OPFPath] = []byte(opfXML)

	var cssPaths []string
	for _, item := range ctx.Manifest {
		if item.MediaType == "text/css" {
			cssPaths = append(cssPaths, item.FullPath)
		}
	}

	if len(cssPaths) == 0 {
		cssHref := "Styles/style.css"
		cssPath := ctx.OPFDir + cssHref
		cssPaths = append(cssPaths, cssPath)

		manifestMatch := manifestRe.FindStringSubmatch(opfXML)
		if len(manifestMatch) >= 4 {
			manifestHeader := manifestMatch[1]
			manifestBody := manifestMatch[2]
			manifestFooter := manifestMatch[3]

			cssTag := fmt.Sprintf(`<item id="style" href="%s" media-type="text/css"/>`, cssHref)
			newManifestBody := "\n    " + cssTag + manifestBody
			opfXML = strings.Replace(opfXML, manifestMatch[0], manifestHeader+newManifestBody+manifestFooter, 1)
			editedFiles[ctx.OPFPath] = []byte(opfXML)
		}
	}

	relativeCSSPathToFont := func(cssPath, fontZipPath string) string {
		dir := path.Dir(cssPath)
		if dir == "." || dir == "" {
			return fontZipPath
		}

		segments := strings.Split(dir, "/")
		var sb strings.Builder
		for i := 0; i < len(segments); i++ {
			sb.WriteString("../")
		}
		sb.WriteString(fontZipPath)
		return sb.String()
	}

	reCleanup := regexp.MustCompile(`(?s)\s*/\* Embedded by EPUBForge \*/.*`)

	for _, cssPath := range cssPaths {

		var cssContent string
		if ctx.Entries[cssPath] != nil {
			existingCSS, _ := ctx.readText(cssPath)
			cssContent = existingCSS
		}

		cssContent = reCleanup.ReplaceAllString(cssContent, "")

		fontRelPath := relativeCSSPathToFont(cssPath, fontZipPath)
		fontFace := fmt.Sprintf("\n\n/* Embedded by EPUBForge */\n@font-face {\n  font-family: '%s';\n  src: url('%s');\n}\n*, body, p, li, h1, h2, h3, h4, h5, h6, span, div, a {\n  font-family: '%s', sans-serif !important;\n}\n", fontFamily, fontRelPath, fontFamily)
		cssContent = cssContent + fontFace
		editedFiles[cssPath] = []byte(cssContent)
	}

	if err := s.pushUndoSnapshot(id); err != nil {
		return BookAnalysis{}, err
	}
	newFileName, err := ctx.writeEditedEPUB(editedFiles)
	if err != nil {
		return BookAnalysis{}, err
	}

	newCtx, err := loadBook(toID(newFileName))
	if err != nil {
		return BookAnalysis{}, err
	}
	defer newCtx.Close()

	return newCtx.Analysis(), nil
}
