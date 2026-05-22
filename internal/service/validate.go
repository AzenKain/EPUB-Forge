package service

import (
	"encoding/xml"
	"fmt"
	"io"
	"path/filepath"
	"regexp"
	"strings"

	"epubforge/internal/models"
)

type validationBuilder struct {
	report models.ValidationReport
}

func (b *validationBuilder) add(severity, code, file, message string) {
	fixID, fixable := repairFixForIssue(code)
	b.report.Issues = append(b.report.Issues, models.ValidationIssue{
		Severity: severity,
		Code:     code,
		File:     file,
		Message:  message,
		Fixable:  fixable,
		FixID:    fixID,
	})
	switch severity {
	case "error":
		b.report.Errors++
	case "warning":
		b.report.Warnings++
	default:
		b.report.Infos++
	}
}

func repairFixForIssue(code string) (string, bool) {
	switch code {
	case "MIMETYPE_FIRST", "MIMETYPE_MISSING", "MIMETYPE_COMPRESSED", "MIMETYPE_VALUE":
		return "PACKAGE_MIMETYPE", true
	case "OPF_VERSION_LEGACY", "METADATA_MODIFIED_MISSING", "NAV_MISSING":
		return "UPGRADE_EPUB3", true
	case "MANIFEST_FILE_MISSING", "SPINE_IDREF_MISSING":
		return "REMOVE_MISSING_MANIFEST_ITEMS", true
	case "MANIFEST_MEDIA_TYPE_PARAMETER", "MANIFEST_MEDIA_TYPE_MISMATCH":
		return "FIX_MEDIA_TYPES", true
	case "ZIP_FILE_UNMANIFESTED", "LINK_TARGET_UNMANIFESTED":
		return "ADD_UNMANIFESTED_FILES", true
	case "XHTML_XML", "XHTML_NAMESPACE":
		return "FIX_XHTML", true
	case "NCX_LINK_MISSING", "NCX_IDREF_MISSING":
		return "FIX_TOC_NCX", true
	case "LINK_TARGET_MISSING":
		return "CLEAN_BROKEN_CONTENT_LINKS", true
	default:
		return "", false
	}
}

func (b *validationBuilder) finish() models.ValidationReport {
	b.report.Valid = b.report.Errors == 0
	if b.report.Issues == nil {
		b.report.Issues = []models.ValidationIssue{}
	}
	return b.report
}

func (s *Service) Validate(id string) (models.ValidationReport, error) {
	lock := s.getBookLock(id)
	lock.Lock()
	defer lock.Unlock()

	ctx, err := loadBook(id)
	if err != nil {
		return models.ValidationReport{}, err
	}
	defer ctx.Close()
	return ctx.Validate(), nil
}

func (ctx *BookContext) Validate() models.ValidationReport {
	var b validationBuilder
	ctx.validatePackage(&b)
	ctx.validateOPF(&b)
	ctx.validateManifestAndSpine(&b)
	ctx.validateNavigation(&b)
	ctx.validateContentDocuments(&b)
	return b.finish()
}

func (ctx *BookContext) validatePackage(b *validationBuilder) {
	if len(ctx.Reader.File) == 0 {
		b.add("error", "ZIP_EMPTY", "", "EPUB archive is empty")
		return
	}

	first := ctx.Reader.File[0]
	if first.Name != "mimetype" {
		b.add("error", "MIMETYPE_FIRST", "mimetype", "mimetype must be the first ZIP entry")
	}
	if f := ctx.Entries["mimetype"]; f == nil {
		b.add("error", "MIMETYPE_MISSING", "mimetype", "missing mimetype file")
	} else {
		if f.Method != 0 {
			b.add("error", "MIMETYPE_COMPRESSED", "mimetype", "mimetype must be stored without compression")
		}
		data, err := readZipFile(f)
		if err != nil {
			b.add("error", "MIMETYPE_READ", "mimetype", err.Error())
		} else if string(data) != "application/epub+zip" {
			b.add("error", "MIMETYPE_VALUE", "mimetype", "mimetype must be exactly application/epub+zip")
		}
	}

	if ctx.Entries["META-INF/container.xml"] == nil {
		b.add("error", "CONTAINER_MISSING", "META-INF/container.xml", "missing EPUB container.xml")
	}
	if ctx.OPFPath == "" {
		b.add("error", "OPF_ROOT_MISSING", "META-INF/container.xml", "container.xml does not declare an OPF rootfile")
	} else if ctx.Entries[ctx.OPFPath] == nil {
		b.add("error", "OPF_FILE_MISSING", ctx.OPFPath, "OPF rootfile does not exist in the archive")
	}
}

func (ctx *BookContext) validateOPF(b *validationBuilder) {
	if err := validateXMLWellFormed(ctx.OPFXML); err != nil {
		b.add("error", "OPF_XML", ctx.OPFPath, fmt.Sprintf("OPF is not well-formed XML: %v", err))
	}

	packageTag := regexp.MustCompile(`(?is)<package\b[^>]*>`).FindString(ctx.OPFXML)
	attrs := parseAttrs(packageTag)
	version := strings.TrimSpace(attrs["version"])
	if version == "" {
		b.add("error", "OPF_VERSION_MISSING", ctx.OPFPath, "OPF package version is missing")
	} else if version != "3.0" {
		b.add("warning", "OPF_VERSION_LEGACY", ctx.OPFPath, "EPUBForge standard output is EPUB 3.0; this file declares version "+version)
	}
	if strings.TrimSpace(attrs["unique-identifier"]) == "" {
		b.add("error", "OPF_UID_MISSING", ctx.OPFPath, "OPF unique-identifier attribute is missing")
	}
	if strings.TrimSpace(ctx.Metadata.Title) == "" {
		b.add("error", "METADATA_TITLE_MISSING", ctx.OPFPath, "dc:title is required")
	}
	if strings.TrimSpace(ctx.Metadata.Language) == "" {
		b.add("error", "METADATA_LANGUAGE_MISSING", ctx.OPFPath, "dc:language is required")
	}
	if !regexp.MustCompile(`(?is)<dc:identifier\b[^>]*>`).MatchString(ctx.OPFXML) {
		b.add("error", "METADATA_IDENTIFIER_MISSING", ctx.OPFPath, "dc:identifier is required")
	}
	if version == "3.0" && !regexp.MustCompile(`(?is)<meta\b[^>]*property\s*=\s*["']dcterms:modified["'][^>]*>`).MatchString(ctx.OPFXML) {
		b.add("error", "METADATA_MODIFIED_MISSING", ctx.OPFPath, "EPUB 3 requires dcterms:modified metadata")
	}
}

func (ctx *BookContext) validateManifestAndSpine(b *validationBuilder) {
	ids := map[string]bool{}
	paths := map[string]bool{}
	for _, item := range ctx.Manifest {
		if strings.TrimSpace(item.ID) == "" {
			b.add("error", "MANIFEST_ID_MISSING", ctx.OPFPath, "manifest item is missing id")
		}
		if ids[item.ID] {
			b.add("error", "MANIFEST_ID_DUPLICATE", ctx.OPFPath, "duplicate manifest id: "+item.ID)
		}
		ids[item.ID] = true

		if strings.TrimSpace(item.Href) == "" {
			b.add("error", "MANIFEST_HREF_MISSING", ctx.OPFPath, "manifest item "+item.ID+" is missing href")
			continue
		}
		if paths[item.FullPath] {
			b.add("warning", "MANIFEST_HREF_DUPLICATE", item.FullPath, "duplicate manifest href: "+item.Href)
		}
		paths[item.FullPath] = true
		if ctx.Entries[item.FullPath] == nil {
			b.add("error", "MANIFEST_FILE_MISSING", item.FullPath, "manifest item points to a missing file")
		}

		if strings.Contains(item.MediaType, ";") {
			b.add("warning", "MANIFEST_MEDIA_TYPE_PARAMETER", ctx.OPFPath, "manifest media-type should not include parameters: "+item.MediaType)
		}
		if !mediaTypeMatchesPath(item.MediaType, item.FullPath) {
			b.add("warning", "MANIFEST_MEDIA_TYPE_MISMATCH", item.FullPath, "media-type "+item.MediaType+" does not match file extension")
		}
	}

	if len(ctx.Spine) == 0 {
		b.add("error", "SPINE_EMPTY", ctx.OPFPath, "spine must contain at least one itemref")
	}
	for _, ref := range ctx.Spine {
		item, ok := ctx.ManifestByID[ref.IDRef]
		if !ok {
			b.add("error", "SPINE_IDREF_MISSING", ctx.OPFPath, "spine itemref points to missing manifest id: "+ref.IDRef)
			continue
		}
		if !strings.Contains(item.MediaType, "xhtml") && !strings.Contains(item.MediaType, "html") {
			b.add("warning", "SPINE_NON_DOCUMENT", item.FullPath, "spine item should point to an XHTML content document")
		}
	}

	for name := range ctx.Entries {
		if shouldIgnoreUnmanifested(name, ctx.OPFPath) || paths[name] {
			continue
		}
		b.add("info", "ZIP_FILE_UNMANIFESTED", name, "file exists in ZIP but is not declared in the manifest")
	}
}

func (ctx *BookContext) validateNavigation(b *validationBuilder) {
	packageTag := regexp.MustCompile(`(?is)<package\b[^>]*>`).FindString(ctx.OPFXML)
	version := strings.TrimSpace(parseAttrs(packageTag)["version"])
	if version == "3.0" {
		navCount := 0
		for _, item := range ctx.Manifest {
			if hasPropertyToken(item.Attrs["properties"], "nav") {
				navCount++
				if item.MediaType != "application/xhtml+xml" {
					b.add("error", "NAV_MEDIA_TYPE", item.FullPath, "EPUB 3 nav document must use application/xhtml+xml")
				}
				if ctx.Entries[item.FullPath] == nil {
					b.add("error", "NAV_FILE_MISSING", item.FullPath, "EPUB 3 nav document is missing")
				}
			}
		}
		if navCount == 0 {
			b.add("error", "NAV_MISSING", ctx.OPFPath, "EPUB 3 requires exactly one manifest item with properties=\"nav\"")
		} else if navCount > 1 {
			b.add("error", "NAV_MULTIPLE", ctx.OPFPath, "EPUB 3 should have exactly one nav document")
		}
	}

	tocID := parseSpineTocID(ctx.OPFXML)
	if tocID != "" {
		if _, ok := ctx.ManifestByID[tocID]; !ok {
			b.add("error", "NCX_IDREF_MISSING", ctx.OPFPath, "spine toc attribute points to missing manifest id: "+tocID)
		}
	}
	if ctx.NCX != nil {
		ncx, err := ctx.readText(ctx.NCX.FullPath)
		if err != nil {
			b.add("error", "NCX_READ", ctx.NCX.FullPath, err.Error())
			return
		}
		if err := validateXMLWellFormed(ncx); err != nil {
			b.add("error", "NCX_XML", ctx.NCX.FullPath, fmt.Sprintf("NCX is not well-formed XML: %v", err))
		}
		for _, point := range parseNCX(ncx, posixDir(ctx.NCX.FullPath)) {
			if point.FullPath == "" || ctx.Entries[point.FullPath] == nil {
				b.add("error", "NCX_LINK_MISSING", ctx.NCX.FullPath, "NCX points to missing file: "+point.Src)
			}
		}
	}
}

func (ctx *BookContext) validateContentDocuments(b *validationBuilder) {
	manifestPaths := map[string]bool{}
	for _, item := range ctx.Manifest {
		manifestPaths[item.FullPath] = true
	}

	for _, item := range ctx.Manifest {
		lower := strings.ToLower(item.FullPath)
		if !strings.HasSuffix(lower, ".xhtml") && !strings.HasSuffix(lower, ".html") && !strings.HasSuffix(lower, ".htm") && !strings.HasSuffix(lower, ".css") {
			continue
		}

		text, err := ctx.readText(item.FullPath)
		if err != nil {
			b.add("error", "CONTENT_READ", item.FullPath, err.Error())
			continue
		}

		var refs []string
		if strings.HasSuffix(lower, ".css") {
			refs = extractCSSRefs(text)
		} else {
			if err := validateXMLWellFormed(text); err != nil {
				b.add("error", "XHTML_XML", item.FullPath, fmt.Sprintf("content document is not well-formed XML: %v", err))
			}
			if !regexp.MustCompile(`(?is)<html\b[^>]*xmlns\s*=\s*["']http://www\.w3\.org/1999/xhtml["']`).MatchString(text) {
				b.add("warning", "XHTML_NAMESPACE", item.FullPath, "XHTML document should declare the XHTML namespace")
			}
			refs = append(refs, extractHTMLRefs(text)...)
			for _, m := range hrefAttrRe.FindAllStringSubmatch(text, -1) {
				if len(m) == 2 {
					refs = append(refs, m[1])
				}
			}
		}

		for _, ref := range dedupeStrings(refs) {
			if skipLocalReference(ref) {
				continue
			}
			resolved := resolveZipHref(posixDir(item.FullPath), ref)
			if resolved == "" {
				continue
			}
			if ctx.Entries[resolved] == nil {
				b.add("error", "LINK_TARGET_MISSING", item.FullPath, "local reference points to missing file: "+ref)
				continue
			}
			if !manifestPaths[resolved] {
				b.add("warning", "LINK_TARGET_UNMANIFESTED", item.FullPath, "local reference points to a file outside the manifest: "+ref)
			}
		}
	}
}

func validateXMLWellFormed(source string) error {
	decoder := xml.NewDecoder(strings.NewReader(source))
	for {
		if _, err := decoder.Token(); err != nil {
			if err == io.EOF {
				return nil
			}
			return err
		}
	}
}

func shouldIgnoreUnmanifested(name, opfPath string) bool {
	lower := strings.ToLower(name)
	return name == "mimetype" ||
		name == opfPath ||
		lower == "meta-inf/container.xml" ||
		strings.HasPrefix(lower, "meta-inf/")
}

func mediaTypeMatchesPath(mediaType, filePath string) bool {
	if mediaType == "" {
		return false
	}
	ext := strings.ToLower(filepath.Ext(filePath))
	switch ext {
	case ".xhtml", ".html", ".htm":
		return mediaType == "application/xhtml+xml"
	case ".css":
		return mediaType == "text/css"
	case ".ncx":
		return mediaType == "application/x-dtbncx+xml"
	case ".opf":
		return mediaType == "application/oebps-package+xml"
	case ".jpg", ".jpeg":
		return mediaType == "image/jpeg"
	case ".png":
		return mediaType == "image/png"
	case ".gif":
		return mediaType == "image/gif"
	case ".webp":
		return mediaType == "image/webp"
	case ".svg":
		return mediaType == "image/svg+xml"
	case ".ttf":
		return mediaType == "application/x-font-ttf" || mediaType == "font/ttf"
	case ".otf":
		return mediaType == "application/x-font-opentype" || mediaType == "font/otf"
	case ".woff":
		return mediaType == "font/woff" || mediaType == "application/font-woff"
	case ".woff2":
		return mediaType == "font/woff2"
	default:
		return true
	}
}

func skipLocalReference(ref string) bool {
	ref = strings.TrimSpace(ref)
	if ref == "" || strings.HasPrefix(ref, "#") || isExternalRef(ref) {
		return true
	}
	lower := strings.ToLower(ref)
	return strings.HasPrefix(lower, "javascript:")
}

func dedupeStrings(values []string) []string {
	seen := map[string]bool{}
	var out []string
	for _, value := range values {
		if seen[value] {
			continue
		}
		seen[value] = true
		out = append(out, value)
	}
	return out
}
