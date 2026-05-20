package service

import (
	"archive/zip"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

func (s *Service) Export(id string, ranges []ExportRange, includeFrontmatter bool, metadata BookMetadata, coverImage string, onProgress func(index, total int, label string)) ([]ExportedFile, error) {
	lock := s.getBookLock(id)
	lock.Lock()
	defer lock.Unlock()

	ctx, err := loadBook(id)
	if err != nil {
		return nil, err
	}
	defer ctx.Close()
	return ctx.Export(ranges, includeFrontmatter, metadata, coverImage, onProgress)
}

func (s *Service) RangeImages(id string, startIndex, endIndex int, includeFrontmatter bool) ([]string, error) {
	lock := s.getBookLock(id)
	lock.Lock()
	defer lock.Unlock()

	ctx, err := loadBook(id)
	if err != nil {
		return nil, err
	}
	defer ctx.Close()
	return ctx.RangeImages(startIndex, endIndex, includeFrontmatter)
}

func (ctx *BookContext) Export(ranges []ExportRange, includeFrontmatter bool, metadata BookMetadata, coverImage string, onProgress func(index, total int, label string)) ([]ExportedFile, error) {
	if len(ranges) == 0 {
		return nil, errors.New("no ranges to export")
	}

	metadata = normalizeMetadata(metadata, ctx.Metadata)
	baseTitle := metadata.Title
	bookDir := filepath.Join(outputRoot, sanitizeFileName(baseTitle))
	if err := os.MkdirAll(bookDir, 0755); err != nil {
		return nil, err
	}
	var outputs []ExportedFile
	for i, r := range ranges {
		if onProgress != nil {
			onProgress(i, len(ranges), r.Label)
		}
		if err := ctx.validateRange(r); err != nil {
			return nil, err
		}

		coverSrc := r.CoverImage
		if coverSrc == "" {
			coverSrc = coverImage
		}

		var customCoverBytes []byte
		if coverSrc != "" {
			resolvedBytes, err := ctx.resolveCoverBytes(coverSrc)
			if err != nil {
				return nil, fmt.Errorf("lỗi xử lý ảnh đại diện cho %s: %w", r.Label, err)
			}
			customCoverBytes = resolvedBytes
		}

		selected := ctx.selectedSpine(r, includeFrontmatter)
		name := fmt.Sprintf("%s - %s.epub", sanitizeFileName(baseTitle), sanitizeFileName(r.Label))
		full := filepath.Join(bookDir, name)
		if err := ctx.writeSplit(full, r.Label, selected, metadata, customCoverBytes); err != nil {
			return nil, err
		}
		info, err := os.Stat(full)
		if err != nil {
			return nil, err
		}
		rel, _ := filepath.Rel(outputRoot, full)
		outputs = append(outputs, ExportedFile{Name: name, Path: full, URL: "/api/files/" + url.PathEscape(filepath.ToSlash(rel)), Size: info.Size()})
	}
	return outputs, nil
}

func (ctx *BookContext) RangeImages(startIndex, endIndex int, includeFrontmatter bool) ([]string, error) {
	r := ExportRange{
		Start: startIndex,
		End:   endIndex,
		Label: "Temporary Range",
	}
	if err := ctx.validateRange(r); err != nil {
		return nil, err
	}
	selected := ctx.selectedSpine(r, includeFrontmatter)
	selectedPaths := map[string]bool{}
	for _, ref := range selected {
		if item, ok := ctx.ManifestByID[ref.IDRef]; ok {
			selectedPaths[item.FullPath] = true
		}
	}
	deps, err := ctx.collectDependencies(selectedPaths)
	if err != nil {
		return nil, err
	}

	imagesMap := map[string]bool{}
	for path := range deps {
		if item, ok := ctx.ManifestByPath[path]; ok {
			if strings.HasPrefix(strings.ToLower(item.MediaType), "image/") {
				imagesMap[path] = true
			}
		}
	}
	for path := range selectedPaths {
		if item, ok := ctx.ManifestByPath[path]; ok {
			if strings.HasPrefix(strings.ToLower(item.MediaType), "image/") {
				imagesMap[path] = true
			}
		}
	}

	images := make([]string, 0, len(imagesMap))
	for path := range imagesMap {
		images = append(images, path)
	}
	sort.Strings(images)
	return images, nil
}

func (ctx *BookContext) validateRange(r ExportRange) error {
	if strings.TrimSpace(r.Label) == "" {
		return errors.New("range label is required")
	}
	if r.Start < 0 || r.End < r.Start || r.End >= len(ctx.Chapters) {
		return fmt.Errorf("invalid range: %s", r.Label)
	}
	return nil
}

func (ctx *BookContext) selectedSpine(r ExportRange, includeFrontmatter bool) []SpineRef {
	var selected []SpineRef
	if includeFrontmatter && r.Start > 0 {
		for idx, ref := range ctx.Spine {
			if idx >= r.Start {
				break
			}
			item, ok := ctx.ManifestByID[ref.IDRef]
			if !ok {
				continue
			}
			name := strings.ToLower(item.Href)
			if strings.Contains(name, "titlepage") || name == "index.html" || strings.HasSuffix(name, "/index.html") {
				selected = append(selected, ref)
			}
		}
	}
	for idx, ref := range ctx.Spine {
		if idx >= r.Start && idx <= r.End {
			selected = append(selected, ref)
		}
	}
	return selected
}

func (ctx *BookContext) writeSplit(outputPath, label string, selected []SpineRef, metadata BookMetadata, customCoverBytes []byte) error {
	selectedIDs := map[string]bool{}
	selectedPaths := map[string]bool{}
	for _, ref := range selected {
		selectedIDs[ref.IDRef] = true
		if item, ok := ctx.ManifestByID[ref.IDRef]; ok {
			selectedPaths[item.FullPath] = true
		}
	}
	if coverID := ctx.coverID(); coverID != "" {
		if item, ok := ctx.ManifestByID[coverID]; ok {
			selectedIDs[coverID] = true
			selectedPaths[item.FullPath] = true
		}
	}
	if ctx.NCX != nil {
		selectedIDs[ctx.NCX.ID] = true
		selectedPaths[ctx.NCX.FullPath] = true
	}
	deps, err := ctx.collectDependencies(selectedPaths)
	if err != nil {
		return err
	}
	for dep := range deps {
		selectedPaths[dep] = true
		if item, ok := ctx.ManifestByPath[dep]; ok {
			selectedIDs[item.ID] = true
		}
	}

	tmp := outputPath + ".tmp"
	out, err := os.Create(tmp)
	if err != nil {
		return err
	}
	zw := zip.NewWriter(out)
	written := map[string]bool{}
	writeEntry := func(name string, data []byte, method uint16) error {
		if written[name] {
			return nil
		}
		written[name] = true
		header := &zip.FileHeader{Name: name, Method: method}
		header.SetMode(0644)
		writer, err := zw.CreateHeader(header)
		if err != nil {
			return err
		}
		_, err = writer.Write(data)
		return err
	}
	if data, err := ctx.readBytes("mimetype"); err == nil {
		if err := writeEntry("mimetype", data, zip.Store); err != nil {
			return closeZipErr(zw, out, tmp, err)
		}
	} else if err := writeEntry("mimetype", []byte("application/epub+zip"), zip.Store); err != nil {
		return closeZipErr(zw, out, tmp, err)
	}
	for _, f := range ctx.Reader.File {
		if f.FileInfo().IsDir() || !strings.HasPrefix(f.Name, "META-INF/") {
			continue
		}
		data, err := readZipFile(f)
		if err != nil {
			return closeZipErr(zw, out, tmp, err)
		}
		if err := writeEntry(f.Name, data, zip.Deflate); err != nil {
			return closeZipErr(zw, out, tmp, err)
		}
	}

	coverPath := ""
	if coverID := ctx.coverID(); coverID != "" {
		if item, ok := ctx.ManifestByID[coverID]; ok {
			coverPath = item.FullPath
		}
	}

	navPath := ""
	for _, item := range ctx.Manifest {
		if strings.Contains(strings.ToLower(item.Attrs["properties"]), "nav") {
			navPath = item.FullPath
			break
		}
	}
	if navPath == "" {
		for _, item := range ctx.Manifest {
			lower := strings.ToLower(item.FullPath)
			if strings.HasSuffix(lower, "nav.xhtml") || strings.HasSuffix(lower, "toc.html") || strings.HasSuffix(lower, "nav.html") || strings.HasSuffix(lower, "index.html") {
				navPath = item.FullPath
				break
			}
		}
	}

	for p := range selectedPaths {
		if p == "mimetype" || p == ctx.OPFPath || (ctx.NCX != nil && p == ctx.NCX.FullPath) {
			continue
		}
		var data []byte
		var err error
		if len(customCoverBytes) > 0 && coverPath != "" && p == coverPath {
			data = customCoverBytes
		} else {
			f := ctx.Entries[p]
			if f == nil || f.FileInfo().IsDir() {
				continue
			}
			data, err = readZipFile(f)
			if err != nil {
				return closeZipErr(zw, out, tmp, err)
			}
			lowerP := strings.ToLower(p)
			if strings.HasSuffix(lowerP, ".html") || strings.HasSuffix(lowerP, ".xhtml") {
				if p == navPath {
					cleanedHTML := ctx.cleanNavHTML(string(data), selected)
					data = []byte(cleanedHTML)
				} else {
					cleanedHTML := cleanDeadVolumeContainers(string(data), p, selectedPaths)
					cleanedHTML = cleanHTMLLinks(cleanedHTML, p, selectedPaths)
					data = []byte(cleanedHTML)
				}
			}
		}
		if err := writeEntry(p, data, zip.Deflate); err != nil {
			return closeZipErr(zw, out, tmp, err)
		}
	}
	volumeMetadata := metadata
	volumeMetadata.Title = strings.TrimSpace(metadata.Title + " - " + label)
	if err := writeEntry(ctx.OPFPath, []byte(ctx.buildOPF(selectedIDs, selected, volumeMetadata)), zip.Deflate); err != nil {
		return closeZipErr(zw, out, tmp, err)
	}
	ncxPath := resolveZipHref(ctx.OPFDir, "toc.ncx")
	if ctx.NCX != nil {
		ncxPath = ctx.NCX.FullPath
	}
	if err := writeEntry(ncxPath, []byte(ctx.buildNCX(selected, volumeMetadata.Title)), zip.Deflate); err != nil {
		return closeZipErr(zw, out, tmp, err)
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
	return os.Rename(tmp, outputPath)
}

func closeZipErr(zw *zip.Writer, out *os.File, tmp string, err error) error {
	_ = zw.Close()
	_ = out.Close()
	_ = os.Remove(tmp)
	return err
}

func (ctx *BookContext) collectDependencies(selected map[string]bool) (map[string]bool, error) {
	found := map[string]bool{}
	var queue []string
	for p := range selected {
		queue = append(queue, p)
	}
	for len(queue) > 0 {
		current := queue[0]
		queue = queue[1:]
		lower := strings.ToLower(current)
		if !strings.HasSuffix(lower, ".html") && !strings.HasSuffix(lower, ".xhtml") && !strings.HasSuffix(lower, ".css") {
			continue
		}
		source, err := ctx.readText(current)
		if err != nil {
			continue
		}
		var refs []string
		if strings.HasSuffix(lower, ".css") {
			refs = extractCSSRefs(source)
		} else {
			refs = extractHTMLRefs(source)
		}
		for _, ref := range refs {
			resolved := resolveZipHref(posixDir(current), ref)
			if resolved == "" || found[resolved] || ctx.Entries[resolved] == nil {
				continue
			}
			found[resolved] = true
			queue = append(queue, resolved)
		}
	}
	return found, nil
}

func (ctx *BookContext) buildOPF(selectedIDs map[string]bool, selected []SpineRef, metadata BookMetadata) string {
	opf := applyMetadataToOPF(ctx.OPFXML, metadata)
	var items []string
	for _, item := range ctx.Manifest {
		if selectedIDs[item.ID] {
			items = append(items, "    "+strings.TrimSpace(item.Raw))
		}
	}
	opf = replaceXMLBlock(manifestRe, opf, strings.Join(items, "\n"))
	var refs []string
	for _, ref := range selected {
		refs = append(refs, "    "+strings.TrimSpace(ref.Raw))
	}
	opf = replaceXMLBlock(spineRe, opf, strings.Join(refs, "\n"))
	return opf
}

func (ctx *BookContext) buildNCX(selected []SpineRef, title string) string {
	var b strings.Builder
	b.WriteString("<?xml version='1.0' encoding='utf-8'?>\n")
	b.WriteString(`<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">` + "\n")
	b.WriteString("  <head>\n")
	b.WriteString(`    <meta name="dtb:uid" content="`)
	b.WriteString(randomID())
	b.WriteString(`"/>`)
	b.WriteString("\n")
	b.WriteString(`    <meta name="dtb:depth" content="1"/>` + "\n")
	b.WriteString(`    <meta name="dtb:totalPageCount" content="0"/>` + "\n")
	b.WriteString(`    <meta name="dtb:maxPageNumber" content="0"/>` + "\n")
	b.WriteString("  </head>\n")
	b.WriteString("  <docTitle><text>")
	b.WriteString(escapeXML(title))
	b.WriteString("</text></docTitle>\n")
	b.WriteString("  <navMap>\n")
	for i, ref := range selected {
		item, ok := ctx.ManifestByID[ref.IDRef]
		if !ok {
			continue
		}
		chapterTitle := item.Href
		for _, ch := range ctx.Chapters {
			if ch.IDRef == ref.IDRef {
				chapterTitle = ch.Title
				break
			}
		}
		b.WriteString(fmt.Sprintf(`    <navPoint id="nav-%d" playOrder="%d">`+"\n", i+1, i+1))
		b.WriteString("      <navLabel><text>")
		b.WriteString(escapeXML(chapterTitle))
		b.WriteString("</text></navLabel>\n")
		b.WriteString(`      <content src="`)
		b.WriteString(escapeXML(item.Href))
		b.WriteString(`"/>`)
		b.WriteString("\n")
		b.WriteString("    </navPoint>\n")
	}
	b.WriteString("  </navMap>\n</ncx>")
	return b.String()
}

func (ctx *BookContext) cleanNavHTML(navHTML string, selected []SpineRef) string {
	var lis []string
	for _, ref := range selected {
		item, ok := ctx.ManifestByID[ref.IDRef]
		if !ok {
			continue
		}
		chapterTitle := item.Href
		for _, ch := range ctx.Chapters {
			if ch.IDRef == ref.IDRef {
				chapterTitle = ch.Title
				break
			}
		}
		lis = append(lis, fmt.Sprintf(`      <li><a href="%s">%s</a></li>`, escapeXML(item.Href), escapeXML(chapterTitle)))
	}
	newOL := "<ol>\n" + strings.Join(lis, "\n") + "\n    </ol>"

	reNav := regexp.MustCompile(`(?is)<nav\b[^>]*>.*?</nav>`)
	navMatches := reNav.FindAllStringIndex(navHTML, -1)

	targetNavIdx := -1
	for _, match := range navMatches {
		block := navHTML[match[0]:match[1]]
		if strings.Contains(strings.ToLower(block), `epub:type="toc"`) || strings.Contains(strings.ToLower(block), `epub:type='toc'`) {
			targetNavIdx = match[0]
			break
		}
	}

	if targetNavIdx == -1 && len(navMatches) > 0 {
		targetNavIdx = navMatches[0][0]
	}

	if targetNavIdx != -1 {
		navBlockClose := findMatchingClosingTag(navHTML, targetNavIdx, "<nav", "</nav>")
		if navBlockClose != -1 {
			navBlock := navHTML[targetNavIdx:navBlockClose]

			reOL := regexp.MustCompile(`(?is)<ol\b[^>]*>.*?</ol>`)
			olMatch := reOL.FindStringIndex(navBlock)
			if olMatch != nil {
				startOL := targetNavIdx + olMatch[0]
				endOL := targetNavIdx + olMatch[1]
				return navHTML[:startOL] + newOL + navHTML[endOL:]
			}
		}
	}

	reOL := regexp.MustCompile(`(?is)<ol\b[^>]*>.*?</ol>`)
	olMatch := reOL.FindStringIndex(navHTML)
	if olMatch != nil {
		return navHTML[:olMatch[0]] + newOL + navHTML[olMatch[1]:]
	}

	return navHTML
}

func cleanDeadVolumeContainers(htmlContent string, docPath string, selectedPaths map[string]bool) string {
	reSection := regexp.MustCompile(`(?is)<section\b[^>]*>.*?</section>`)

	cleaned := reSection.ReplaceAllStringFunc(htmlContent, func(sectionBlock string) string {
		lowerBlock := strings.ToLower(sectionBlock)
		if !strings.Contains(lowerBlock, "volume") && !strings.Contains(lowerBlock, "list-chapters") {
			return sectionBlock
		}

		reA := regexp.MustCompile(`(?is)<a\b[^>]*\bhref\s*=\s*["']([^"']*)["'][^>]*>`)
		aMatches := reA.FindAllStringSubmatch(sectionBlock, -1)

		hasActiveLink := false
		for _, match := range aMatches {
			if len(match) < 2 {
				continue
			}
			href := strings.Split(match[1], "#")[0]
			if isExternalRef(href) {
				continue
			}
			resolved := resolveZipHref(posixDir(docPath), href)
			if resolved != "" && selectedPaths[resolved] {
				hasActiveLink = true
				break
			}
		}

		if !hasActiveLink {
			return ""
		}

		return sectionBlock
	})

	return cleaned
}

func cleanHTMLLinks(htmlContent string, docPath string, selectedPaths map[string]bool) string {
	reLI := regexp.MustCompile(`(?is)<li\b[^>]*>.*?</li>`)
	cleaned := reLI.ReplaceAllStringFunc(htmlContent, func(liBlock string) string {
		reA := regexp.MustCompile(`(?is)<a\b[^>]*\bhref\s*=\s*["']([^"']*)["'][^>]*>`)
		aMatch := reA.FindStringSubmatch(liBlock)
		if len(aMatch) < 2 {
			return liBlock
		}
		href := strings.Split(aMatch[1], "#")[0]
		resolved := resolveZipHref(posixDir(docPath), href)
		if resolved != "" && !isExternalRef(href) && !selectedPaths[resolved] {
			return ""
		}
		return liBlock
	})

	reA := regexp.MustCompile(`(?is)<a\b[^>]*\bhref\s*=\s*["']([^"']*)["'][^>]*>(.*?)</a>`)
	cleaned = reA.ReplaceAllStringFunc(cleaned, func(aBlock string) string {
		match := reA.FindStringSubmatch(aBlock)
		if len(match) < 3 {
			return aBlock
		}
		href := strings.Split(match[1], "#")[0]
		resolved := resolveZipHref(posixDir(docPath), href)
		if resolved != "" && !isExternalRef(href) && !selectedPaths[resolved] {
			return ""
		}
		return aBlock
	})

	reXemTiepLI := regexp.MustCompile(`(?is)<li\b[^>]*>[^<]*?xem\s+tiếp\b.*?</li>`)
	cleaned = reXemTiepLI.ReplaceAllString(cleaned, "")

	reXemTiepP := regexp.MustCompile(`(?is)<p\b[^>]*>[^<]*?xem\s+tiếp\b.*?</p>`)
	cleaned = reXemTiepP.ReplaceAllString(cleaned, "")

	reXemTiepA := regexp.MustCompile(`(?is)<a\b[^>]*>[^<]*?xem\s+tiếp\b.*?</a>`)
	cleaned = reXemTiepA.ReplaceAllString(cleaned, "")

	return cleaned
}

func (ctx *BookContext) coverID() string {
	for _, item := range ctx.Manifest {
		if hasPropertyToken(item.Attrs["properties"], "cover-image") {
			return item.ID
		}
	}
	for _, match := range regexp.MustCompile(`(?is)<meta\b[^>]*>`).FindAllString(ctx.OPFXML, -1) {
		attrs := parseAttrs(match)
		if attrs["name"] == "cover" {
			return attrs["content"]
		}
	}
	return ""
}

func hasPropertyToken(properties string, token string) bool {
	for _, part := range strings.Fields(properties) {
		if part == token {
			return true
		}
	}
	return false
}

func addPropertyToken(properties string, token string) string {
	if hasPropertyToken(properties, token) {
		return strings.TrimSpace(properties)
	}
	properties = strings.TrimSpace(properties)
	if properties == "" {
		return token
	}
	return properties + " " + token
}

func removePropertyToken(properties string, token string) string {
	parts := strings.Fields(properties)
	filtered := parts[:0]
	for _, part := range parts {
		if part != token {
			filtered = append(filtered, part)
		}
	}
	return strings.Join(filtered, " ")
}

func coverMetaTag(coverID string) string {
	if strings.TrimSpace(coverID) == "" {
		return ""
	}
	return fmt.Sprintf(`    <meta name="cover" content="%s"/>`, escapeXML(coverID))
}

func (ctx *BookContext) detectVolumes() []DetectedVolume {
	chapters := ctx.Chapters
	toc := ctx.TOC
	indexByPath := map[string]int{}
	for _, ch := range chapters {
		indexByPath[ch.Path] = ch.Index
	}
	var starts []volumeStart
	starts = ctx.addVolumeIndexHTMLStarts(starts, indexByPath)
	starts = ctx.addChapterHTMLVolumeRuns(starts)
	pending := ""
	for _, point := range toc {
		label := extractVolumeLabel(point.Title)
		chapterIndex, hasChapter := indexByPath[point.FullPath]
		isHeading := strings.HasSuffix(point.FullPath, "index.html") || !hasChapter
		if label != "" && isHeading {
			pending = label
			continue
		}
		if pending != "" && hasChapter {
			starts = pushStart(starts, volumeStart{label: pending, index: chapterIndex, reason: "TOC có heading volume ngay trước chương này", confidence: "medium"})
			pending = ""
		}
	}
	for _, ch := range chapters {
		if label := extractVolumeLabel(ch.Title + " " + ch.Href); label != "" {
			starts = pushStart(starts, volumeStart{label: label, index: ch.Index, reason: "Tên chương hoặc file chứa nhãn volume", confidence: "medium"})
		}
	}
	starts = addFrontmatterClusterStarts(starts, chapters)
	starts = addChapterSequenceResetStarts(starts, chapters)
	sort.Slice(starts, func(i, j int) bool { return starts[i].index < starts[j].index })
	starts = normalizeVolumeStarts(starts)
	volumes := make([]DetectedVolume, 0)
	for i, s := range starts {
		end := 0
		if i+1 < len(starts) {
			end = starts[i+1].index - 1
		} else if len(chapters) > 0 {
			end = chapters[len(chapters)-1].Index
		} else {
			end = s.index
		}
		volumes = append(volumes, DetectedVolume{Label: s.label, Start: s.index, End: end, Confidence: s.confidence, Reason: s.reason})
	}
	return volumes
}

func (ctx *BookContext) addVolumeIndexHTMLStarts(starts []volumeStart, indexByPath map[string]int) []volumeStart {
	for _, item := range ctx.Manifest {
		if !isHTMLManifestItem(item) {
			continue
		}
		htmlSource, err := ctx.readText(item.FullPath)
		if err != nil || !strings.Contains(strings.ToLower(htmlSource), "volume_") {
			continue
		}
		matches := volumeHeaderRe.FindAllStringIndex(htmlSource, -1)
		if len(matches) == 0 {
			continue
		}
		for i, match := range matches {
			headerHTML := htmlSource[match[0]:match[1]]
			volumeChunkStart := match[0]
			chunkEnd := len(htmlSource)
			if i+1 < len(matches) {
				chunkEnd = matches[i+1][0]
			}
			chapterIndex, linkCount, ok := firstLinkedChapterIndex(htmlSource[volumeChunkStart:chunkEnd], item.FullPath, indexByPath)
			if !ok {
				continue
			}
			label := indexVolumeHeaderLabel(headerHTML, linkCount)
			if label != "" {
				starts = pushStart(starts, volumeStart{
					label:      label,
					index:      chapterIndex,
					reason:     "Trang mục lục HTML có header volume và danh sách chapter tương ứng",
					confidence: "high",
				})
			}
		}
	}
	return starts
}

func indexVolumeHeaderLabel(headerHTML string, linkedChapters int) string {
	headerText := firstVolumeHeaderLabelText(headerHTML)
	if label := extractVolumeLabel(headerText); label != "" {
		return label
	}
	headerText = strings.TrimSpace(headerText)
	if headerText == "" || linkedChapters < 2 || isAuxiliaryIndexSection(headerText) {
		return ""
	}
	return headerText
}

func firstVolumeHeaderLabelText(headerHTML string) string {
	for _, match := range volumeHeaderAnchorRe.FindAllStringSubmatch(headerHTML, -1) {
		if len(match) < 3 {
			continue
		}
		href := strings.TrimSpace(match[1])
		if !strings.HasPrefix(href, "#") {
			continue
		}
		if text := cleanText(stripTags(match[2])); text != "" {
			return text
		}
	}

	labelHTML := headerHTML
	lower := strings.ToLower(labelHTML)
	for _, marker := range []string{"<ul", "<ol", "<li"} {
		if idx := strings.Index(lower, marker); idx >= 0 {
			labelHTML = labelHTML[:idx]
			break
		}
	}
	return cleanText(stripTags(labelHTML))
}

func isAuxiliaryIndexSection(label string) bool {
	normalized := strings.ToLower(removeVietnameseMarks(cleanText(label)))
	normalized = strings.Join(strings.Fields(normalized), " ")
	switch normalized {
	case "character", "characters", "nhan vat", "illustration", "illustrations", "minh hoa", "extra", "extras":
		return true
	default:
		return false
	}
}

func (ctx *BookContext) addChapterHTMLVolumeRuns(starts []volumeStart) []volumeStart {
	lastLabel := ""
	for _, ch := range ctx.Chapters {
		label := ctx.topVolumeLabel(ch.Path)
		if label == "" || label == lastLabel {
			continue
		}
		startIndex := volumeStartFromChapter(ctx.Chapters, ch.Index)
		if hasNearbyVolumeStart(starts, startIndex, 2) {
			lastLabel = label
			continue
		}
		starts = pushStart(starts, volumeStart{
			label:      label,
			index:      startIndex,
			reason:     "Nội dung chapter có heading volume lặp theo từng cụm",
			confidence: "medium",
		})
		lastLabel = label
	}
	return starts
}

func (ctx *BookContext) topVolumeLabel(chapterPath string) string {
	source, err := ctx.readText(chapterPath)
	if err != nil {
		return ""
	}
	if len(source) > 6000 {
		source = source[:6000]
	}
	for _, heading := range regexp.MustCompile(`(?is)<h[1-6]\b[^>]*>.*?</h[1-6]>|<title\b[^>]*>.*?</title>`).FindAllString(source, -1) {
		if label := extractVolumeLabel(stripTags(heading)); label != "" {
			return label
		}
	}
	return ""
}

func isHTMLManifestItem(item ManifestItem) bool {
	mediaType := strings.ToLower(item.MediaType)
	fullPath := strings.ToLower(item.FullPath)
	return mediaType == "application/xhtml+xml" ||
		mediaType == "text/html" ||
		strings.HasSuffix(fullPath, ".html") ||
		strings.HasSuffix(fullPath, ".xhtml")
}

func firstLinkedChapterIndex(source string, basePath string, indexByPath map[string]int) (int, int, bool) {
	best := 0
	count := 0
	found := false
	for _, match := range hrefAttrRe.FindAllStringSubmatch(source, -1) {
		if len(match) < 2 || isExternalRef(match[1]) || strings.HasPrefix(match[1], "#") {
			continue
		}
		resolved := resolveZipHref(posixDir(basePath), strings.Split(match[1], "#")[0])
		if idx, ok := indexByPath[resolved]; ok {
			count++
			if !found || idx < best {
				best = idx
				found = true
			}
		}
	}
	return best, count, found
}

func addFrontmatterClusterStarts(starts []volumeStart, chapters []Chapter) []volumeStart {
	var clusterStarts []int
	for i := 0; i < len(chapters); {
		if !isVolumeFrontmatterTitle(chapters[i].Title) {
			i++
			continue
		}
		start := i
		hasStrongSignal := isStrongVolumeFrontmatterTitle(chapters[i].Title)
		for i+1 < len(chapters) && isVolumeFrontmatterTitle(chapters[i+1].Title) {
			i++
			if isStrongVolumeFrontmatterTitle(chapters[i].Title) {
				hasStrongSignal = true
			}
		}
		hasContentAfter := i+1 < len(chapters) && !isVolumeFrontmatterTitle(chapters[i+1].Title)
		hasContentBefore := start > 0 && !isVolumeFrontmatterTitle(chapters[start-1].Title)
		if hasStrongSignal && hasContentAfter && (start == 0 || hasContentBefore) {
			clusterStarts = append(clusterStarts, chapters[start].Index)
		}
		i++
	}
	if len(clusterStarts) < 2 {
		return starts
	}
	for i, index := range clusterStarts {
		if hasNearbyVolumeStart(starts, index, 2) {
			continue
		}
		starts = pushStart(starts, volumeStart{
			label:      fmt.Sprintf("VOL %d", i+1),
			index:      index,
			reason:     "Phát hiện cụm bìa/minh họa/frontmatter lặp lại trước nội dung",
			confidence: "medium",
		})
	}
	return starts
}

func addChapterSequenceResetStarts(starts []volumeStart, chapters []Chapter) []volumeStart {
	if len(chapters) == 0 {
		return starts
	}

	type sequenceMark struct {
		index    int
		sequence []int
	}
	var marks []sequenceMark
	for _, ch := range chapters {
		sequence := structuralNumberSequence(ch.Title)
		if len(sequence) > 0 {
			marks = append(marks, sequenceMark{index: ch.Index, sequence: sequence})
		}
	}
	if len(marks) < 2 {
		return starts
	}

	var resetStarts []int
	resetStarts = append(resetStarts, volumeStartFromChapter(chapters, marks[0].index))
	segmentMaxSequence := append([]int(nil), marks[0].sequence...)
	for _, mark := range marks[1:] {
		if compareNumberSequence(mark.sequence, segmentMaxSequence) < 0 {
			startIndex := volumeStartFromChapter(chapters, mark.index)
			if startIndex >= 0 && !hasNearbyStart(resetStarts, startIndex, 2) {
				resetStarts = append(resetStarts, startIndex)
			}
			segmentMaxSequence = append([]int(nil), mark.sequence...)
			continue
		}
		if compareNumberSequence(mark.sequence, segmentMaxSequence) > 0 {
			segmentMaxSequence = append([]int(nil), mark.sequence...)
		}
	}

	if len(resetStarts) < 2 {
		return starts
	}
	resetStarts = filterResetStartsInsideHighIntervals(resetStarts, starts)
	if len(resetStarts) < 2 {
		return starts
	}

	starts = removeStartsNearChapterResets(starts, resetStarts, 2)
	for i, index := range resetStarts {
		starts = pushStart(starts, volumeStart{
			label:      fmt.Sprintf("VOL %d", i+1),
			index:      index,
			reason:     "Phát hiện chuỗi đánh số cấu trúc bị reset và kéo về phần bìa/illustration trước đó",
			confidence: "medium",
		})
	}
	return starts
}

func filterResetStartsInsideHighIntervals(resetStarts []int, starts []volumeStart) []int {
	var highStarts []int
	for _, start := range starts {
		if start.confidence == "high" {
			highStarts = append(highStarts, start.index)
		}
	}
	if len(highStarts) == 0 {
		return resetStarts
	}
	sort.Ints(highStarts)
	filtered := resetStarts[:0]
	for _, resetStart := range resetStarts {
		if isInsideHighInterval(resetStart, highStarts) {
			continue
		}
		filtered = append(filtered, resetStart)
	}
	return filtered
}

func isInsideHighInterval(index int, highStarts []int) bool {
	for i, start := range highStarts {
		if index == start {
			return true
		}
		if i+1 < len(highStarts) && index > start && index < highStarts[i+1] {
			return true
		}
	}
	return false
}

func removeStartsNearChapterResets(starts []volumeStart, resetStarts []int, tolerance int) []volumeStart {
	filtered := starts[:0]
	for _, start := range starts {
		if start.confidence == "high" {
			filtered = append(filtered, start)
			continue
		}
		if hasNearbyStart(resetStarts, start.index, tolerance) {
			continue
		}
		filtered = append(filtered, start)
	}
	return filtered
}

func volumeStartFromChapter(chapters []Chapter, chapterIndex int) int {
	start := chapterIndex
	strongStart := -1
	for i := chapterIndex - 1; i >= 0 && chapterIndex-i <= 5; i-- {
		title := strings.TrimSpace(chapters[i].Title)
		if title == "" {
			start = i
			continue
		}
		if len(structuralNumberSequence(title)) > 0 {
			break
		}
		if isStrongVolumeFrontmatterTitle(title) {
			strongStart = i
			start = i
			break
		}
		if isVolumeFrontmatterTitle(title) {
			start = i
			continue
		}
		break
	}
	if strongStart >= 0 {
		return strongStart
	}
	return start
}

func normalizeVolumeStarts(starts []volumeStart) []volumeStart {
	if len(starts) < 2 {
		return starts
	}

	filtered := make([]volumeStart, 0, len(starts))
	for _, start := range starts {
		if start.index < 0 {
			continue
		}
		if len(filtered) == 0 {
			filtered = append(filtered, start)
			continue
		}

		prev := &filtered[len(filtered)-1]
		if start.index == prev.index || sameVolumeOrdinal(start.label, prev.label) {
			if shouldReplaceStart(*prev, start) {
				*prev = start
			}
			continue
		}
		if start.index-prev.index <= 2 && shouldMergeNearbyStarts(*prev, start) {
			if shouldReplaceStart(*prev, start) {
				*prev = start
			}
			continue
		}
		filtered = append(filtered, start)
	}
	return filtered
}

func shouldMergeNearbyStarts(current, candidate volumeStart) bool {
	return isGeneratedSequenceStart(current) ||
		isGeneratedSequenceStart(candidate) ||
		isChapterHTMLVolumeStart(current) ||
		isChapterHTMLVolumeStart(candidate) ||
		isTOCVolumeStart(current) ||
		isTOCVolumeStart(candidate)
}

func shouldReplaceStart(current, candidate volumeStart) bool {
	currentRank := confidenceRank(current.confidence)
	candidateRank := confidenceRank(candidate.confidence)
	if candidateRank != currentRank {
		return candidateRank > currentRank
	}
	if isGeneratedSequenceStart(candidate) != isGeneratedSequenceStart(current) {
		return isGeneratedSequenceStart(candidate)
	}
	if isStructuredVolumeLabel(candidate.label) != isStructuredVolumeLabel(current.label) {
		return isStructuredVolumeLabel(candidate.label)
	}
	return candidate.index < current.index
}

func confidenceRank(confidence string) int {
	if confidence == "high" {
		return 2
	}
	if confidence == "medium" {
		return 1
	}
	return 0
}

func isGeneratedSequenceStart(start volumeStart) bool {
	return strings.Contains(start.reason, "chuỗi đánh số")
}

func isChapterHTMLVolumeStart(start volumeStart) bool {
	return strings.Contains(start.reason, "Nội dung chapter")
}

func isTOCVolumeStart(start volumeStart) bool {
	return strings.Contains(start.reason, "TOC")
}

func sameVolumeOrdinal(left, right string) bool {
	leftNum := volumeOrdinal(left)
	rightNum := volumeOrdinal(right)
	return leftNum > 0 && leftNum == rightNum
}

func volumeOrdinal(label string) int {
	match := regexp.MustCompile(`(?i)\b(?:vol(?:ume)?\.?|tập|tap|quyển|quyen)\s*0*(\d{1,4})\b`).FindStringSubmatch(removeVietnameseMarks(label))
	if len(match) < 2 {
		return 0
	}
	number, err := strconv.Atoi(match[1])
	if err != nil {
		return 0
	}
	return number
}

func isStructuredVolumeLabel(label string) bool {
	normalized := strings.ToLower(removeVietnameseMarks(label))
	return strings.Contains(normalized, "(ln)") ||
		strings.Contains(normalized, "light novel") ||
		strings.Contains(normalized, "(wn)") ||
		strings.Contains(normalized, "web novel")
}

func isVolumeFrontmatterTitle(title string) bool {
	normalized := strings.ToLower(removeVietnameseMarks(cleanText(title)))
	normalized = strings.Join(strings.Fields(normalized), " ")
	if normalized == "" || normalized == "unknown" {
		return true
	}
	if normalized == "prologue" || normalized == "epilogue" || strings.HasPrefix(normalized, "loi mo dau") {
		return true
	}
	return isStrongVolumeFrontmatterTitle(normalized)
}

func isStrongVolumeFrontmatterTitle(title string) bool {
	normalized := strings.ToLower(removeVietnameseMarks(cleanText(title)))
	normalized = strings.Join(strings.Fields(normalized), " ")
	return strings.Contains(normalized, "cover") ||
		strings.Contains(normalized, "bia") ||
		strings.Contains(normalized, "illustration") ||
		strings.Contains(normalized, "illustrations") ||
		strings.Contains(normalized, "minh hoa") ||
		strings.Contains(normalized, "color") ||
		strings.Contains(normalized, "insert") ||
		strings.Contains(normalized, "front")
}

func removeVietnameseMarks(input string) string {
	replacer := strings.NewReplacer(
		"à", "a", "á", "a", "ả", "a", "ã", "a", "ạ", "a",
		"ă", "a", "ằ", "a", "ắ", "a", "ẳ", "a", "ẵ", "a", "ặ", "a",
		"â", "a", "ầ", "a", "ấ", "a", "ẩ", "a", "ẫ", "a", "ậ", "a",
		"è", "e", "é", "e", "ẻ", "e", "ẽ", "e", "ẹ", "e",
		"ê", "e", "ề", "e", "ế", "e", "ể", "e", "ễ", "e", "ệ", "e",
		"ì", "i", "í", "i", "ỉ", "i", "ĩ", "i", "ị", "i",
		"ò", "o", "ó", "o", "ỏ", "o", "õ", "o", "ọ", "o",
		"ô", "o", "ồ", "o", "ố", "o", "ổ", "o", "ỗ", "o", "ộ", "o",
		"ơ", "o", "ờ", "o", "ớ", "o", "ở", "o", "ỡ", "o", "ợ", "o",
		"ù", "u", "ú", "u", "ủ", "u", "ũ", "u", "ụ", "u",
		"ư", "u", "ừ", "u", "ứ", "u", "ử", "u", "ữ", "u", "ự", "u",
		"ỳ", "y", "ý", "y", "ỷ", "y", "ỹ", "y", "ỵ", "y",
		"đ", "d",
	)
	return replacer.Replace(input)
}

func structuralNumberSequence(title string) []int {
	normalized := removeVietnameseMarks(cleanText(title))
	normalized = strings.Join(strings.Fields(normalized), " ")
	matches := structureNumberRe.FindAllStringSubmatch(normalized, -1)
	if len(matches) == 0 {
		return nil
	}
	sequence := make([]int, 0, len(matches))
	for _, match := range matches {
		if len(match) < 2 {
			continue
		}
		number, err := strconv.Atoi(match[1])
		if err == nil {
			sequence = append(sequence, number)
		}
	}
	return sequence
}

func compareNumberSequence(left, right []int) int {
	limit := len(left)
	if len(right) < limit {
		limit = len(right)
	}
	for i := 0; i < limit; i++ {
		if left[i] < right[i] {
			return -1
		}
		if left[i] > right[i] {
			return 1
		}
	}
	if len(left) < len(right) {
		return -1
	}
	if len(left) > len(right) {
		return 1
	}
	return 0
}

func hasNearbyStart(starts []int, index int, tolerance int) bool {
	for _, start := range starts {
		if absInt(start-index) <= tolerance {
			return true
		}
	}
	return false
}

func hasNearbyVolumeStart(starts []volumeStart, index int, tolerance int) bool {
	for _, start := range starts {
		if absInt(start.index-index) <= tolerance {
			return true
		}
	}
	return false
}

func absInt(value int) int {
	if value < 0 {
		return -value
	}
	return value
}

func pushStart(starts []volumeStart, next volumeStart) []volumeStart {
	for _, s := range starts {
		if s.index == next.index {
			return starts
		}
	}
	return append(starts, next)
}

func extractVolumeLabel(input string) string {
	match := volumeRe.FindString(strings.Join(strings.Fields(input), " "))
	return strings.TrimSpace(match)
}

func extractHTMLRefs(source string) []string {
	var refs []string
	for _, m := range srcRe.FindAllStringSubmatch(source, -1) {
		if !isExternalRef(m[1]) && !strings.HasPrefix(m[1], "#") {
			refs = append(refs, m[1])
		}
	}
	for _, m := range linkRe.FindAllStringSubmatch(source, -1) {
		tag, ref := m[0], m[1]
		if regexp.MustCompile(`(?is)rel\s*=\s*["'][^"']*(stylesheet|icon|preload|prefetch)[^"']*["']`).MatchString(tag) && !isExternalRef(ref) {
			refs = append(refs, ref)
		}
	}
	for _, m := range srcsetRe.FindAllStringSubmatch(source, -1) {
		for _, entry := range strings.Split(m[1], ",") {
			ref := strings.Fields(strings.TrimSpace(entry))
			if len(ref) > 0 && !isExternalRef(ref[0]) {
				refs = append(refs, ref[0])
			}
		}
	}
	return append(refs, extractCSSRefs(source)...)
}

func extractCSSRefs(source string) []string {
	var refs []string
	for _, m := range cssURLRe.FindAllStringSubmatch(source, -1) {
		ref := strings.Trim(strings.TrimSpace(m[1]), `"'`)
		if ref != "" && !isExternalRef(ref) {
			refs = append(refs, ref)
		}
	}
	return refs
}

func rewriteHTMLAssetLinks(source, id, baseDir string) string {
	re := regexp.MustCompile(`(?is)\s(src|href|xlink:href)\s*=\s*["']([^"']+)["']`)
	return re.ReplaceAllStringFunc(source, func(full string) string {
		m := re.FindStringSubmatch(full)
		if len(m) != 3 || isExternalRef(m[2]) || strings.HasPrefix(m[2], "#") {
			return full
		}
		resolved := resolveZipHref(baseDir, m[2])
		return fmt.Sprintf(` %s="/api/epubs/%s/assets?path=%s"`, m[1], url.PathEscape(id), url.QueryEscape(resolved))
	})
}

func rewriteCSSURLs(source, id, baseDir string) string {
	return cssURLRe.ReplaceAllStringFunc(source, func(full string) string {
		m := cssURLRe.FindStringSubmatch(full)
		ref := strings.Trim(strings.TrimSpace(m[1]), `"'`)
		if ref == "" || isExternalRef(ref) {
			return full
		}
		resolved := resolveZipHref(baseDir, ref)
		return fmt.Sprintf(`url("/api/epubs/%s/assets?path=%s")`, url.PathEscape(id), url.QueryEscape(resolved))
	})
}

func (ctx *BookContext) resolveCoverBytes(coverImageStr string) ([]byte, error) {
	if coverImageStr == "" {
		return nil, nil
	}

	var rawBytes []byte
	var err error

	if strings.HasPrefix(coverImageStr, "data:image/") {
		rawBytes, _, err = parseBase64Image(coverImageStr)
		if err != nil {
			return nil, fmt.Errorf("lỗi đọc ảnh đại diện base64: %w", err)
		}
	} else if strings.HasPrefix(coverImageStr, "http://") || strings.HasPrefix(coverImageStr, "https://") {
		resp, err := http.Get(coverImageStr)
		if err != nil {
			return nil, fmt.Errorf("lỗi tải ảnh từ link: %w", err)
		}
		defer resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			return nil, fmt.Errorf("lỗi tải ảnh từ link (HTTP %d)", resp.StatusCode)
		}
		rawBytes, err = io.ReadAll(resp.Body)
		if err != nil {
			return nil, fmt.Errorf("lỗi đọc dữ liệu ảnh tải về: %w", err)
		}
	} else {
		rawBytes, err = ctx.readBytes(coverImageStr)
		if err != nil {
			return nil, fmt.Errorf("lỗi đọc ảnh từ sách tại %s: %w", coverImageStr, err)
		}
	}

	targetMime := "image/jpeg"
	if coverID := ctx.coverID(); coverID != "" {
		if item, ok := ctx.ManifestByID[coverID]; ok {
			targetMime = item.MediaType
		}
	}

	converted, err := convertImage(rawBytes, targetMime)
	if err != nil {
		return nil, fmt.Errorf("lỗi chuyển đổi định dạng ảnh: %w", err)
	}

	return converted, nil
}
