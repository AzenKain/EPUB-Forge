package service

import (
	"archive/zip"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
)

type BookContext struct {
	ID             string
	FilePath       string
	FileName       string
	Size           int64
	Reader         *zip.ReadCloser
	Entries        map[string]*zip.File
	OPFPath        string
	OPFDir         string
	OPFXML         string
	Manifest       []ManifestItem
	ManifestByID   map[string]ManifestItem
	ManifestByPath map[string]ManifestItem
	Spine          []SpineRef
	Chapters       []Chapter
	Title          string
	Creator        string
	Metadata       BookMetadata
	NCX            *ManifestItem
	TOC            []TocPoint
	Detected       []DetectedVolume
}

type ManifestItem struct {
	ID        string
	Href      string
	FullPath  string
	MediaType string
	Raw       string
	Attrs     map[string]string
}

type SpineRef struct {
	IDRef  string
	Linear bool
	Raw    string
	Attrs  map[string]string
}

type TocPoint struct {
	Title    string
	Src      string
	FullPath string
}

func loadBook(id string) (*BookContext, error) {
	name, err := fromID(id)
	if err != nil {
		return nil, err
	}
	filePath := filepath.Join(editDir, name)
	info, err := os.Stat(filePath)
	if err != nil {
		return nil, err
	}
	reader, err := zip.OpenReader(filePath)
	if err != nil {
		return nil, err
	}
	ctx := &BookContext{
		ID: id, FilePath: filePath, FileName: name, Size: info.Size(), Reader: reader,
		Entries: map[string]*zip.File{}, ManifestByID: map[string]ManifestItem{}, ManifestByPath: map[string]ManifestItem{},
	}
	for _, f := range reader.File {
		ctx.Entries[f.Name] = f
	}
	if err := ctx.parse(); err != nil {
		_ = reader.Close()
		return nil, err
	}
	return ctx, nil
}

func (ctx *BookContext) Close() {
	if ctx.Reader != nil {
		_ = ctx.Reader.Close()
	}
}

func (ctx *BookContext) parse() error {
	container, err := ctx.readText("META-INF/container.xml")
	if err != nil {
		return err
	}
	ctx.OPFPath = parseRootfile(container)
	if ctx.OPFPath == "" {
		return errors.New("cannot find OPF rootfile")
	}
	ctx.OPFDir = posixDir(ctx.OPFPath)
	ctx.OPFXML, err = ctx.readText(ctx.OPFPath)
	if err != nil {
		return err
	}
	ctx.Metadata = parseBookMetadata(ctx.OPFXML, ctx.FileName)
	ctx.Title = ctx.Metadata.Title
	ctx.Creator = ctx.Metadata.Creator
	if ctx.Title == "" {
		ctx.Title = strings.TrimSuffix(ctx.FileName, filepath.Ext(ctx.FileName))
	}
	ctx.Manifest = parseManifest(ctx.OPFXML, ctx.OPFDir)
	for _, item := range ctx.Manifest {
		ctx.ManifestByID[item.ID] = item
		ctx.ManifestByPath[item.FullPath] = item
		if ctx.NCX == nil && (item.MediaType == "application/x-dtbncx+xml" || strings.HasSuffix(strings.ToLower(item.FullPath), ".ncx")) {
			copy := item
			ctx.NCX = &copy
		}
	}
	ctx.Spine = parseSpine(ctx.OPFXML)
	tocID := parseSpineTocID(ctx.OPFXML)
	if tocID != "" {
		if item, ok := ctx.ManifestByID[tocID]; ok {
			copy := item
			ctx.NCX = &copy
		}
	}
	if ctx.NCX != nil {
		if ncx, err := ctx.readText(ctx.NCX.FullPath); err == nil {
			ctx.TOC = parseNCX(ncx, ctx.OPFDir)
		}
	}
	if coverID := ctx.coverID(); coverID != "" {
		if item, ok := ctx.ManifestByID[coverID]; ok {
			ctx.Metadata.CoverImage = item.FullPath
		}
	}
	ctx.Chapters = ctx.buildChapters()
	ctx.Detected = ctx.detectVolumes()
	return nil
}

func (ctx *BookContext) Analysis() BookAnalysis {
	spine := ctx.Chapters
	if spine == nil {
		spine = []Chapter{}
	}
	detected := ctx.Detected
	if detected == nil {
		detected = []DetectedVolume{}
	}
	coverPath := ""
	if coverID := ctx.coverID(); coverID != "" {
		if item, ok := ctx.ManifestByID[coverID]; ok {
			coverPath = item.FullPath
		}
	}
	images := make([]string, 0)
	for _, item := range ctx.Manifest {
		if strings.HasPrefix(strings.ToLower(item.MediaType), "image/") {
			images = append(images, item.FullPath)
		}
	}
	sort.Strings(images)

	return BookAnalysis{
		ID: ctx.ID, FileName: ctx.FileName, Title: ctx.Title, Creator: ctx.Creator, Metadata: ctx.Metadata,
		Size: ctx.Size, Spine: spine, DetectedVolumes: detected,
		CoverPath: coverPath, Images: images,
	}
}

func (ctx *BookContext) buildChapters() []Chapter {
	chapters := make([]Chapter, len(ctx.Spine))
	for idx, ref := range ctx.Spine {
		item, ok := ctx.ManifestByID[ref.IDRef]
		if !ok {
			continue
		}
		chapters[idx] = Chapter{
			Index: idx, IDRef: ref.IDRef, Href: item.Href, Path: item.FullPath,
			MediaType: item.MediaType, Linear: ref.Linear,
		}
	}

	lastMatchedIdx := 0
	matchedTitles := make(map[int]string)

	for _, point := range ctx.TOC {
		if point.Title == "" {
			continue
		}

		matched := false
		for j := lastMatchedIdx; j < len(chapters); j++ {
			if chapters[j].Path == point.FullPath {
				matchedTitles[j] = point.Title
				lastMatchedIdx = j + 1
				matched = true
				break
			}
		}

		if !matched {
			for j := 0; j < len(chapters); j++ {
				if chapters[j].Path == point.FullPath {
					if _, exists := matchedTitles[j]; !exists {
						matchedTitles[j] = point.Title
						break
					}
				}
			}
		}
	}

	res := make([]Chapter, 0)
	for idx := range chapters {
		if chapters[idx].IDRef == "" {
			continue
		}
		title := matchedTitles[idx]
		if title == "" {
			title = ctx.htmlTitle(chapters[idx].Path)
		}
		if title == "" {
			title = chapters[idx].Href
		}
		chapters[idx].Title = title
		chapters[idx].Index = len(res)
		res = append(res, chapters[idx])
	}
	return res
}

func (ctx *BookContext) Asset(assetPath, id string) ([]byte, string, error) {
	normalized := normalizeZipPath(assetPath)
	f := ctx.Entries[normalized]
	if f == nil {
		return nil, "", fmt.Errorf("missing asset: %s", normalized)
	}
	data, err := readZipFile(f)
	if err != nil {
		return nil, "", err
	}
	contentType := contentTypeFor(normalized)
	if contentType == "text/css" {
		data = []byte(rewriteCSSURLs(string(data), id, posixDir(normalized)))
	}
	return data, contentType, nil
}

func (ctx *BookContext) readText(name string) (string, error) {
	data, err := ctx.readBytes(name)
	if err != nil {
		return "", err
	}
	return string(data), nil
}

func (ctx *BookContext) readBytes(name string) ([]byte, error) {
	f := ctx.Entries[normalizeZipPath(name)]
	if f == nil {
		return nil, fmt.Errorf("missing EPUB file: %s", name)
	}
	return readZipFile(f)
}

func (ctx *BookContext) htmlTitle(name string) string {
	lower := strings.ToLower(name)
	if !strings.HasSuffix(lower, ".html") && !strings.HasSuffix(lower, ".xhtml") {
		return ""
	}
	text, err := ctx.readText(name)
	if err != nil {
		return ""
	}
	m := htmlTitleRe.FindStringSubmatch(text)
	if len(m) == 0 {
		return ""
	}
	if m[1] != "" {
		return cleanText(stripTags(m[1]))
	}
	return cleanText(stripTags(m[2]))
}

func readZipFile(f *zip.File) ([]byte, error) {
	rc, err := f.Open()
	if err != nil {
		return nil, err
	}
	defer rc.Close()
	return io.ReadAll(rc)
}

func parseRootfile(container string) string {
	for _, tag := range regexp.MustCompile(`(?is)<rootfile\b[^>]*>`).FindAllString(container, -1) {
		attrs := parseAttrs(tag)
		if attrs["full-path"] != "" {
			return normalizeZipPath(attrs["full-path"])
		}
	}
	return ""
}

func parseManifest(opf, opfDir string) []ManifestItem {
	block := firstBlock(manifestRe, opf)
	var items []ManifestItem
	for _, raw := range itemRe.FindAllString(block, -1) {
		attrs := parseAttrs(raw)
		href := attrs["href"]
		item := ManifestItem{
			ID: attrs["id"], Href: href, FullPath: resolveZipHref(opfDir, href),
			MediaType: attrs["media-type"], Raw: raw, Attrs: attrs,
		}
		items = append(items, item)
	}
	return items
}

func parseSpine(opf string) []SpineRef {
	block := firstBlock(spineRe, opf)
	var refs []SpineRef
	for _, raw := range itemrefRe.FindAllString(block, -1) {
		attrs := parseAttrs(raw)
		refs = append(refs, SpineRef{IDRef: attrs["idref"], Linear: attrs["linear"] != "no", Raw: raw, Attrs: attrs})
	}
	return refs
}

func parseSpineTocID(opf string) string {
	match := regexp.MustCompile(`(?is)<spine\b[^>]*>`).FindString(opf)
	return parseAttrs(match)["toc"]
}

func parseBookMetadata(opf, fileName string) BookMetadata {
	metadata := BookMetadata{
		Title:       cleanText(stripTags(firstSubmatch(titleTextRe, opf))),
		Creator:     cleanText(stripTags(firstSubmatch(creatorTextRe, opf))),
		Language:    cleanText(stripTags(firstSubmatch(languageTextRe, opf))),
		Publisher:   cleanText(stripTags(firstSubmatch(publisherTextRe, opf))),
		Description: cleanDescription(firstSubmatch(descriptionTextRe, opf)),
		Subject:     cleanText(stripTags(firstSubmatch(subjectTextRe, opf))),
	}

	for _, match := range regexp.MustCompile(`(?is)<meta\b[^>]*>`).FindAllString(opf, -1) {
		attrs := parseAttrs(match)
		switch attrs["name"] {
		case "calibre:series":
			metadata.Series = cleanText(attrs["content"])
		case "calibre:series_index":
			metadata.SeriesIndex = cleanText(attrs["content"])
		}
	}

	if metadata.Title == "" {
		metadata.Title = strings.TrimSuffix(fileName, filepath.Ext(fileName))
	}
	return metadata
}

func normalizeMetadata(metadata, fallback BookMetadata) BookMetadata {
	metadata.Title = strings.TrimSpace(metadata.Title)
	metadata.Creator = strings.TrimSpace(metadata.Creator)
	metadata.Language = strings.TrimSpace(metadata.Language)
	metadata.Publisher = strings.TrimSpace(metadata.Publisher)
	metadata.Description = strings.TrimSpace(metadata.Description)
	metadata.Subject = strings.TrimSpace(metadata.Subject)
	metadata.Series = strings.TrimSpace(metadata.Series)
	metadata.SeriesIndex = strings.TrimSpace(metadata.SeriesIndex)
	if metadata.Title == "" {
		metadata.Title = fallback.Title
	}
	if metadata.Creator == "" {
		metadata.Creator = fallback.Creator
	}
	if metadata.Language == "" {
		metadata.Language = fallback.Language
	}
	if metadata.Publisher == "" {
		metadata.Publisher = fallback.Publisher
	}
	if metadata.Description == "" {
		metadata.Description = fallback.Description
	}
	if metadata.Subject == "" {
		metadata.Subject = fallback.Subject
	}
	if metadata.Series == "" {
		metadata.Series = fallback.Series
	}
	if metadata.SeriesIndex == "" {
		metadata.SeriesIndex = fallback.SeriesIndex
	}
	if metadata.CoverImage == "" {
		metadata.CoverImage = fallback.CoverImage
	}
	if metadata.Title == "" {
		metadata.Title = "Untitled"
	}
	return metadata
}

func applyMetadataToOPF(opf string, metadata BookMetadata) string {
	replacements := []struct {
		name  string
		value string
	}{
		{name: "dc:title", value: metadata.Title},
		{name: "dc:creator", value: metadata.Creator},
		{name: "dc:language", value: metadata.Language},
		{name: "dc:publisher", value: metadata.Publisher},
		{name: "dc:description", value: metadata.Description},
		{name: "dc:subject", value: metadata.Subject},
	}
	next := opf
	for _, replacement := range replacements {
		next = upsertSimpleElement(next, replacement.name, replacement.value)
	}
	next = upsertCalibreMeta(next, "calibre:series", metadata.Series)
	next = upsertCalibreMeta(next, "calibre:series_index", metadata.SeriesIndex)
	return next
}

func upsertSimpleElement(opf, name, value string) string {
	value = strings.TrimSpace(value)
	re := regexp.MustCompile(`(?is)<` + regexp.QuoteMeta(name) + `\b[^>]*>.*?</` + regexp.QuoteMeta(name) + `>`)
	if value == "" {
		return re.ReplaceAllString(opf, "")
	}
	element := "<" + name + ">" + escapeXML(value) + "</" + name + ">"
	if re.MatchString(opf) {
		return re.ReplaceAllString(opf, element)
	}
	idx := metadataRe.FindStringSubmatchIndex(opf)
	if len(idx) < 8 {
		return opf
	}
	insertAt := idx[6]
	return opf[:insertAt] + "    " + element + "\n  " + opf[insertAt:]
}

func upsertCalibreMeta(opf, name, value string) string {
	name = strings.TrimSpace(name)
	value = strings.TrimSpace(value)

	re := regexp.MustCompile(`(?is)<meta\b[^>]*name\s*=\s*["']` + regexp.QuoteMeta(name) + `["'][^>]*>`)

	if value == "" {
		return re.ReplaceAllString(opf, "")
	}

	newMeta := `<meta name="` + name + `" content="` + escapeXML(value) + `"/>`
	if re.MatchString(opf) {
		return re.ReplaceAllString(opf, newMeta)
	}

	idx := metadataRe.FindStringSubmatchIndex(opf)
	if len(idx) < 8 {
		return opf
	}
	insertAt := idx[6]
	return opf[:insertAt] + "    " + newMeta + "\n  " + opf[insertAt:]
}

func applyCoverImageToOPF(opf string, coverPath string, manifest []ManifestItem) string {
	if coverPath == "" {
		return opf
	}

	var coverItem *ManifestItem
	for _, item := range manifest {
		if item.FullPath == coverPath {
			copy := item
			coverItem = &copy
			break
		}
	}
	if coverItem == nil {
		for _, item := range manifest {
			if strings.HasSuffix(strings.ToLower(item.FullPath), strings.ToLower(coverPath)) || strings.HasSuffix(strings.ToLower(item.Href), strings.ToLower(coverPath)) {
				copy := item
				coverItem = &copy
				break
			}
		}
	}

	if coverItem == nil {
		return opf
	}

	manifestMatch := manifestRe.FindStringSubmatch(opf)
	if len(manifestMatch) >= 4 {
		manifestBody := manifestMatch[2]
		items := itemRe.FindAllString(manifestBody, -1)
		var newItems []string
		for _, raw := range items {
			attrs := parseAttrs(raw)
			id := attrs["id"]
			href := attrs["href"]
			mediaType := attrs["media-type"]
			properties := attrs["properties"]

			if id == coverItem.ID {
				properties = addPropertyToken(properties, "cover-image")
			} else {
				properties = removePropertyToken(properties, "cover-image")
			}

			var sb strings.Builder
			sb.WriteString(fmt.Sprintf(`<item id="%s" href="%s" media-type="%s"`, escapeXML(id), escapeXML(href), escapeXML(mediaType)))
			if properties != "" {
				sb.WriteString(fmt.Sprintf(` properties="%s"`, escapeXML(properties)))
			}
			for k, v := range attrs {
				if k != "id" && k != "href" && k != "media-type" && k != "properties" {
					sb.WriteString(fmt.Sprintf(` %s="%s"`, k, escapeXML(v)))
				}
			}
			sb.WriteString("/>")
			newItems = append(newItems, "    "+sb.String())
		}
		opf = replaceXMLBlock(manifestRe, opf, strings.Join(newItems, "\n"))
	}

	opf = upsertCalibreMeta(opf, "cover", coverItem.ID)
	return opf
}

func (ctx *BookContext) SaveOriginalMetadata(metadata BookMetadata) error {
	metadata = normalizeMetadata(metadata, ctx.Metadata)
	tmp := ctx.FilePath + ".tmp"
	out, err := os.Create(tmp)
	if err != nil {
		return err
	}
	zw := zip.NewWriter(out)

	var newCoverBytes []byte
	isNewImageFile := false
	hasOriginalCover := false
	var targetCoverPath string

	if coverID := ctx.coverID(); coverID != "" {
		if item, ok := ctx.ManifestByID[coverID]; ok {
			targetCoverPath = item.FullPath
			hasOriginalCover = true
		}
	}

	if metadata.CoverImage != "" && (strings.HasPrefix(metadata.CoverImage, "data:image/") || strings.HasPrefix(metadata.CoverImage, "http://") || strings.HasPrefix(metadata.CoverImage, "https://")) {
		resolved, err := ctx.resolveCoverBytes(metadata.CoverImage)
		if err == nil {
			newCoverBytes = resolved
			isNewImageFile = true
		}
	}

	coverWritten := false

	for _, f := range ctx.Reader.File {
		if f.FileInfo().IsDir() {
			continue
		}
		var data []byte
		if f.Name == ctx.OPFPath {
			opfContent := applyMetadataToOPF(ctx.OPFXML, metadata)
			if metadata.CoverImage != "" && !isNewImageFile {
				opfContent = applyCoverImageToOPF(opfContent, metadata.CoverImage, ctx.Manifest)
			} else if isNewImageFile && !hasOriginalCover {
				targetCoverPath = ctx.OPFDir + "cover.jpg"
				opfContent = upsertCalibreMeta(opfContent, "cover", "cover-image")
				newItemTag := `    <item id="cover-image" href="cover.jpg" media-type="image/jpeg" properties="cover-image"/>`
				manifestMatch := manifestRe.FindStringSubmatch(opfContent)
				if len(manifestMatch) >= 4 {
					manifestBody := manifestMatch[2]
					opfContent = replaceXMLBlock(manifestRe, opfContent, manifestBody+"\n"+newItemTag)
				}
			}
			data = []byte(opfContent)
		} else if isNewImageFile && targetCoverPath != "" && f.Name == targetCoverPath {
			data = newCoverBytes
			coverWritten = true
		} else {
			data, err = readZipFile(f)
			if err != nil {
				return closeZipErr(zw, out, tmp, err)
			}
		}
		method := uint16(zip.Deflate)
		if f.Name == "mimetype" {
			method = zip.Store
		}
		header := &zip.FileHeader{Name: f.Name, Method: method}
		header.SetMode(f.Mode())
		writer, err := zw.CreateHeader(header)
		if err != nil {
			return closeZipErr(zw, out, tmp, err)
		}
		if _, err := writer.Write(data); err != nil {
			return closeZipErr(zw, out, tmp, err)
		}
	}

	if isNewImageFile && !coverWritten && len(newCoverBytes) > 0 {
		if targetCoverPath == "" {
			targetCoverPath = ctx.OPFDir + "cover.jpg"
		}
		header := &zip.FileHeader{Name: targetCoverPath, Method: zip.Deflate}
		header.SetMode(0644)
		writer, err := zw.CreateHeader(header)
		if err != nil {
			return closeZipErr(zw, out, tmp, err)
		}
		if _, err := writer.Write(newCoverBytes); err != nil {
			return closeZipErr(zw, out, tmp, err)
		}
	}
	if err := zw.Close(); err != nil {
		_ = out.Close()
		_ = os.Remove(tmp)
		return err
	}
	if err := out.Close(); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	ctx.Close()
	if err := os.Remove(ctx.FilePath); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	if err := os.Rename(tmp, ctx.FilePath); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	return nil
}

func toID(name string) string {
	return base64.RawURLEncoding.EncodeToString([]byte(name))
}

func fromID(id string) (string, error) {
	data, err := base64.RawURLEncoding.DecodeString(id)
	if err != nil {
		return "", err
	}
	name := string(data)
	if strings.ContainsAny(name, `/\`) || filepath.Base(name) != name || !strings.HasSuffix(strings.ToLower(name), ".epub") {
		return "", errors.New("invalid EPUB id")
	}
	return name, nil
}

func parseNCX(ncx, opfDir string) []TocPoint {
	var points []TocPoint
	reNavPoint := regexp.MustCompile(`(?is)<navPoint\b[^>]*>(.*?)</navPoint>`)
	reTitle := regexp.MustCompile(`(?is)<text\b[^>]*>(.*?)</text>`)
	reContent := regexp.MustCompile(`(?is)<content\b[^>]*\bsrc\s*=\s*["']([^"']*)["']`)

	for _, match := range reNavPoint.FindAllStringSubmatch(ncx, -1) {
		body := match[1]
		titleMatch := reTitle.FindStringSubmatch(body)
		contentMatch := reContent.FindStringSubmatch(body)
		if len(titleMatch) >= 2 && len(contentMatch) >= 2 {
			title := cleanText(stripTags(titleMatch[1]))
			src := contentMatch[1]
			points = append(points, TocPoint{
				Title:    title,
				Src:      src,
				FullPath: resolveZipHref(opfDir, src),
			})
		}
	}
	return points
}
