package service

import (
	"archive/zip"
	"bufio"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
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
	isCached       bool
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

type bookCacheKey struct {
	path           string
	size           int64
	modTime        int64
	overlayVersion int64
}

type bookCacheValue struct {
	OPFPath  string
	OPFDir   string
	OPFXML   string
	Manifest []ManifestItem
	Spine    []SpineRef
	Chapters []Chapter
	Title    string
	Creator  string
	Metadata BookMetadata
	NCX      *ManifestItem
	TOC      []TocPoint
	Detected []DetectedVolume
}

type titleCacheKey struct {
	crc  uint32
	size uint64
}

var (
	bookCache                = make(map[bookCacheKey]bookCacheValue)
	bookCacheMu              sync.RWMutex
	titleCache               = make(map[titleCacheKey]string)
	titleCacheMu             sync.RWMutex
	overlayVersions          = make(map[string]int64)
	overlayStructureVersions = make(map[string]int64)
	overlayVersionsMu        sync.RWMutex

	zipReaderCacheMu sync.Mutex
	zipReaderCache   = make(map[string]zipReaderCacheVal)
)

type zipReaderCacheVal struct {
	reader  *zip.ReadCloser
	entries map[string]*zip.File
	size    int64
	modTime int64
}

func closeZipReaderForBook(id string, reader *zip.ReadCloser) {
	closedProvidedReader := false

	zipReaderCacheMu.Lock()
	if cVal, ok := zipReaderCache[id]; ok {
		if cVal.reader != nil {
			_ = cVal.reader.Close()
			if reader != nil && cVal.reader == reader {
				closedProvidedReader = true
			}
		}
		delete(zipReaderCache, id)
	}
	zipReaderCacheMu.Unlock()

	if reader != nil && !closedProvidedReader {
		_ = reader.Close()
	}
}

func invalidateBookCacheForPath(filePath string) {
	bookCacheMu.Lock()
	defer bookCacheMu.Unlock()
	for k := range bookCache {
		if k.path == filePath {
			delete(bookCache, k)
		}
	}
}

func replaceBookFileWithTemp(id string, ctx *BookContext, tmpPath string) error {
	filePath := ctx.FilePath
	closeZipReaderForBook(id, ctx.Reader)
	ctx.Reader = nil
	invalidateBookCacheForPath(filePath)

	if err := removeFileWithRetry(filePath); err != nil && !os.IsNotExist(err) {
		_ = os.Remove(tmpPath)
		return err
	}
	if err := renameFileWithRetry(tmpPath, filePath); err != nil {
		_ = os.Remove(tmpPath)
		return err
	}
	return nil
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

	zipReaderCacheMu.Lock()
	cVal, found := zipReaderCache[id]
	if found && cVal.size == info.Size() && cVal.modTime == info.ModTime().UnixNano() {
		ctx := &BookContext{
			ID: id, FilePath: filePath, FileName: name, Size: info.Size(),
			Reader: cVal.reader, Entries: cVal.entries, isCached: true,
			ManifestByID: map[string]ManifestItem{}, ManifestByPath: map[string]ManifestItem{},
		}
		zipReaderCacheMu.Unlock()
		if err := ctx.parse(); err != nil {
			return nil, err
		}
		checkAndRecoverOverlay(id, filePath)
		return ctx, nil
	}
	zipReaderCacheMu.Unlock()

	reader, err := zip.OpenReader(filePath)
	if err != nil {
		return nil, err
	}

	entries := make(map[string]*zip.File)
	for _, f := range reader.File {
		entries[f.Name] = f
	}

	zipReaderCacheMu.Lock()
	if oldVal, ok := zipReaderCache[id]; ok {
		_ = oldVal.reader.Close()
	}
	zipReaderCache[id] = zipReaderCacheVal{
		reader:  reader,
		entries: entries,
		size:    info.Size(),
		modTime: info.ModTime().UnixNano(),
	}
	zipReaderCacheMu.Unlock()

	ctx := &BookContext{
		ID: id, FilePath: filePath, FileName: name, Size: info.Size(),
		Reader: reader, Entries: entries, isCached: true,
		ManifestByID: map[string]ManifestItem{}, ManifestByPath: map[string]ManifestItem{},
	}
	if err := ctx.parse(); err != nil {
		return nil, err
	}
	checkAndRecoverOverlay(id, filePath)
	return ctx, nil
}

func (ctx *BookContext) Close() {
	if ctx.Reader != nil && !ctx.isCached {
		_ = ctx.Reader.Close()
	}
}

func (ctx *BookContext) getOverlayDir() string {
	return filepath.Join(editDir, ".overlay", ctx.ID)
}

func (ctx *BookContext) isDeletedInOverlay(name string) bool {
	deletedFile := filepath.Join(ctx.getOverlayDir(), ".deleted")
	data, err := os.ReadFile(deletedFile)
	if err != nil {
		return false
	}
	normalizedName := normalizeZipPath(name)
	lines := strings.Split(string(data), "\n")
	for _, line := range lines {
		if normalizeZipPath(strings.TrimSpace(line)) == normalizedName {
			return true
		}
	}
	return false
}

func (ctx *BookContext) parse() error {
	info, err := os.Stat(ctx.FilePath)
	if err != nil {
		return err
	}

	overlayVersionsMu.RLock()
	overlayVer := overlayStructureVersions[ctx.ID]
	overlayVersionsMu.RUnlock()

	key := bookCacheKey{
		path:           ctx.FilePath,
		size:           info.Size(),
		modTime:        info.ModTime().UnixNano(),
		overlayVersion: overlayVer,
	}

	bookCacheMu.RLock()
	val, found := bookCache[key]
	bookCacheMu.RUnlock()

	if found {
		ctx.OPFPath = val.OPFPath
		ctx.OPFDir = val.OPFDir
		ctx.OPFXML = val.OPFXML
		ctx.Manifest = val.Manifest
		ctx.Spine = val.Spine
		ctx.Chapters = val.Chapters
		ctx.Title = val.Title
		ctx.Creator = val.Creator
		ctx.Metadata = val.Metadata
		ctx.NCX = val.NCX
		ctx.TOC = val.TOC
		ctx.Detected = val.Detected

		for _, item := range ctx.Manifest {
			ctx.ManifestByID[item.ID] = item
			ctx.ManifestByPath[item.FullPath] = item
		}

		for i, ch := range ctx.Chapters {
			overlayPath := filepath.Join(ctx.getOverlayDir(), ch.Path)
			if _, err := os.Stat(overlayPath); err == nil {
				ctx.Chapters[i].Title = ctx.htmlTitle(ch.Path)
			}
		}
		return nil
	}

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

	bookCacheMu.Lock()
	bookCache[key] = bookCacheValue{
		OPFPath:  ctx.OPFPath,
		OPFDir:   ctx.OPFDir,
		OPFXML:   ctx.OPFXML,
		Manifest: ctx.Manifest,
		Spine:    ctx.Spine,
		Chapters: ctx.Chapters,
		Title:    ctx.Title,
		Creator:  ctx.Creator,
		Metadata: ctx.Metadata,
		NCX:      ctx.NCX,
		TOC:      ctx.TOC,
		Detected: ctx.Detected,
	}
	bookCacheMu.Unlock()

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

	fallbackTitles := make([]string, len(chapters))
	var fallbackIndexes []int
	for idx := range chapters {
		if chapters[idx].IDRef != "" && matchedTitles[idx] == "" {
			fallbackIndexes = append(fallbackIndexes, idx)
		}
	}
	runWorkers(len(fallbackIndexes), func(taskIndex int) {
		idx := fallbackIndexes[taskIndex]
		fallbackTitles[idx] = ctx.htmlTitle(chapters[idx].Path)
	})

	res := make([]Chapter, 0)
	for idx := range chapters {
		if chapters[idx].IDRef == "" {
			continue
		}
		title := matchedTitles[idx]
		if title == "" {
			title = fallbackTitles[idx]
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
	if ctx.isDeletedInOverlay(normalized) {
		return nil, "", fmt.Errorf("missing asset (deleted in overlay): %s", normalized)
	}
	overlayPath := filepath.Join(ctx.getOverlayDir(), normalized)
	if _, err := os.Stat(overlayPath); err == nil {
		data, err := os.ReadFile(overlayPath)
		if err != nil {
			return nil, "", err
		}
		contentType := contentTypeFor(normalized)
		if contentType == "text/css" {
			data = []byte(rewriteCSSURLs(string(data), id, posixDir(normalized)))
		}
		return data, contentType, nil
	}

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
	normalized := normalizeZipPath(name)
	if ctx.isDeletedInOverlay(normalized) {
		return nil, fmt.Errorf("missing EPUB file (deleted in overlay): %s", name)
	}
	overlayPath := filepath.Join(ctx.getOverlayDir(), normalized)
	if _, err := os.Stat(overlayPath); err == nil {
		return os.ReadFile(overlayPath)
	}

	f := ctx.Entries[normalized]
	if f == nil {
		return nil, fmt.Errorf("missing EPUB file: %s", name)
	}
	return readZipFile(f)
}

func (ctx *BookContext) htmlTitle(name string) string {
	normalized := normalizeZipPath(name)
	overlayPath := filepath.Join(ctx.getOverlayDir(), normalized)

	var key titleCacheKey
	hasOverlay := false
	if info, err := os.Stat(overlayPath); err == nil {
		hasOverlay = true
		key = titleCacheKey{
			crc:  uint32(info.ModTime().UnixNano()),
			size: uint64(info.Size()),
		}
	} else {
		f := ctx.Entries[normalized]
		if f == nil {
			return ""
		}
		key = titleCacheKey{
			crc:  f.CRC32,
			size: f.UncompressedSize64,
		}
	}

	titleCacheMu.RLock()
	cachedTitle, found := titleCache[key]
	titleCacheMu.RUnlock()
	if found {
		return cachedTitle
	}

	lower := strings.ToLower(name)
	if !strings.HasSuffix(lower, ".html") && !strings.HasSuffix(lower, ".xhtml") {
		return ""
	}

	var text string
	var err error
	if hasOverlay {
		data, errRead := os.ReadFile(overlayPath)
		if errRead != nil {
			return ""
		}
		text = string(data)
	} else {
		text, err = ctx.readText(name)
		if err != nil {
			return ""
		}
	}

	m := htmlTitleRe.FindStringSubmatch(text)
	var title string
	if len(m) > 0 {
		if m[1] != "" {
			title = cleanText(stripTags(m[1]))
		} else {
			title = cleanText(stripTags(m[2]))
		}
	}

	titleCacheMu.Lock()
	titleCache[key] = title
	titleCacheMu.Unlock()

	return title
}

func readZipFile(f *zip.File) ([]byte, error) {
	rc, err := f.Open()
	if err != nil {
		return nil, err
	}
	defer rc.Close()
	return io.ReadAll(rc)
}

func copyZipEntry(zw *zip.Writer, f *zip.File, buf []byte) error {
	r, err := f.OpenRaw()
	if err != nil {
		return err
	}
	fw, err := zw.CreateRaw(&f.FileHeader)
	if err != nil {
		return err
	}
	_, err = io.CopyBuffer(fw, r, buf)
	return err
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

	if metadata.Series == "" {
		seriesMatch := regexp.MustCompile(`(?is)<meta\b[^>]*property=["']belongs-to-collection["'][^>]*>(.*?)</meta>`).FindStringSubmatch(opf)
		if len(seriesMatch) >= 2 {
			metadata.Series = cleanText(stripTags(seriesMatch[1]))
		}
	}
	if metadata.SeriesIndex == "" {
		indexMatch := regexp.MustCompile(`(?is)<meta\b[^>]*property=["']group-position["'][^>]*>(.*?)</meta>`).FindStringSubmatch(opf)
		if len(indexMatch) >= 2 {
			metadata.SeriesIndex = cleanText(stripTags(indexMatch[1]))
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
	next = upsertEPUB3Property(next, "belongs-to-collection", metadata.Series)
	next = upsertEPUB3Property(next, "group-position", metadata.SeriesIndex)
	return next
}

func upsertEPUB3Property(opf, property, value string) string {
	property = strings.TrimSpace(property)
	value = strings.TrimSpace(value)

	re := regexp.MustCompile(`(?is)<meta\b[^>]*property\s*=\s*["']` + regexp.QuoteMeta(property) + `["'][^>]*>.*?</meta>`)

	if value == "" {
		return re.ReplaceAllString(opf, "")
	}

	newMeta := `<meta property="` + property + `">` + escapeXML(value) + `</meta>`
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
	bufOut := bufio.NewWriterSize(out, 2*1024*1024)
	zw := zip.NewWriter(bufOut)
	copyBuf := make([]byte, 1024*1024)

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
			header := &zip.FileHeader{Name: f.Name, Method: zip.Deflate}
			header.SetMode(f.Mode())
			writer, err := zw.CreateHeader(header)
			if err != nil {
				return closeZipErr(zw, out, tmp, err)
			}
			if _, err := writer.Write([]byte(opfContent)); err != nil {
				return closeZipErr(zw, out, tmp, err)
			}
		} else if isNewImageFile && targetCoverPath != "" && f.Name == targetCoverPath {
			header := &zip.FileHeader{Name: f.Name, Method: zip.Deflate}
			header.SetMode(f.Mode())
			writer, err := zw.CreateHeader(header)
			if err != nil {
				return closeZipErr(zw, out, tmp, err)
			}
			if _, err := writer.Write(newCoverBytes); err != nil {
				return closeZipErr(zw, out, tmp, err)
			}
			coverWritten = true
		} else {
			if err := copyZipEntry(zw, f, copyBuf); err != nil {
				return closeZipErr(zw, out, tmp, err)
			}
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
	if err := bufOut.Flush(); err != nil {
		_ = out.Close()
		_ = os.Remove(tmp)
		return err
	}
	if err := out.Close(); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	if err := replaceBookFileWithTemp(ctx.ID, ctx, tmp); err != nil {
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

func checkAndRecoverOverlay(id string, filePath string) {
	overlayDir := filepath.Join(editDir, ".overlay", id)
	if oInfo, err := os.Stat(overlayDir); err == nil && oInfo.IsDir() {
		if hasOverlayFiles(overlayDir) {
			overlayVersionsMu.Lock()
			if overlayVersions[id] == 0 {
				overlayVersions[id] = time.Now().UnixNano()
			}
			overlayVersionsMu.Unlock()

			select {
			case bgSaveChan <- bgSaveJob{id: id, filePath: filePath}:
			default:
				go func() {
					bgSaveChan <- bgSaveJob{id: id, filePath: filePath}
				}()
			}
		}
	}
}

func hasOverlayFiles(dir string) bool {
	files, err := os.ReadDir(dir)
	if err != nil {
		return false
	}
	for _, f := range files {
		if f.Name() != ".deleted" {
			return true
		}
	}
	deletedFile := filepath.Join(dir, ".deleted")
	if oInfo, err := os.Stat(deletedFile); err == nil && oInfo.Size() > 0 {
		return true
	}
	return false
}
