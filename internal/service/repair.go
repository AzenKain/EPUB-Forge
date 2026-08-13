package service

import (
	"archive/zip"
	"bufio"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"epubforge/internal/models"
)

type repairSelection map[string]bool

func newRepairSelection(fixes []string) repairSelection {
	selected := repairSelection{}
	for _, fix := range fixes {
		fix = strings.TrimSpace(fix)
		if fix != "" {
			selected[fix] = true
		}
	}
	return selected
}

func (s repairSelection) empty() bool {
	return len(s) == 0
}

func (s repairSelection) has(fix string) bool {
	return s[fix]
}

func (s *Service) Repair(id string, fixes []string) (models.RepairResponse, error) {
	zipMu := getZipWriteLock(id)
	zipMu.Lock()
	defer zipMu.Unlock()

	lock := s.getBookLock(id)
	lock.Lock()
	defer lock.Unlock()

	ctx, err := loadBook(id)
	if err != nil {
		return models.RepairResponse{}, err
	}
	defer ctx.Close()

	selected := newRepairSelection(fixes)
	if selected.empty() {
		return models.RepairResponse{
			Success:  true,
			Logs:     []string{"Chưa chọn mục nào để sửa."},
			Analysis: ctx.Analysis(),
			Report:   ctx.Validate(),
		}, nil
	}

	var logs []string
	editedFiles := make(map[string][]byte)
	removedManifestIDs := make(map[string]bool)
	correctedMediaTypes := make(map[string]string)
	var addedManifestItems []ManifestItem

	for _, item := range ctx.Manifest {
		f, ok := ctx.Entries[item.FullPath]
		if !ok || f.FileInfo().IsDir() {
			if selected.has("REMOVE_MISSING_MANIFEST_ITEMS") {
				removedManifestIDs[item.ID] = true
				if spineUsesID(ctx.Spine, item.ID) {
					logs = append(logs, fmt.Sprintf("[Spine] Đã loại bỏ chương bị thiếu khỏi spine: %s (ID: %s)", item.Href, item.ID))
				} else {
					logs = append(logs, fmt.Sprintf("[Manifest] Đã loại bỏ tài nguyên bị thiếu khỏi manifest: %s (ID: %s)", item.Href, item.ID))
				}
			}
			continue
		}

		if selected.has("FIX_MEDIA_TYPES") {
			correctMediaType := contentTypeFor(item.FullPath)
			if item.MediaType != correctMediaType {
				correctedMediaTypes[item.ID] = correctMediaType
				logs = append(logs, fmt.Sprintf("[Manifest] Đã sửa media-type cho %s: %s -> %s", item.Href, item.MediaType, correctMediaType))
			}
		}
	}

	if selected.has("ADD_UNMANIFESTED_FILES") {
		for p, f := range ctx.Entries {
			if f.FileInfo().IsDir() || shouldIgnoreUnmanifested(p, ctx.OPFPath) {
				continue
			}
			lowerPath := strings.ToLower(p)
			if strings.HasSuffix(lowerPath, ".tmp") || strings.HasSuffix(lowerPath, ".bak") || strings.HasSuffix(lowerPath, ".opf") || strings.HasSuffix(lowerPath, ".ncx") {
				continue
			}
			if _, ok := ctx.ManifestByPath[p]; ok {
				continue
			}
			newID := uniqueRepairManifestID(ctx, addedManifestItems, "added_"+strings.ReplaceAll(filepath.Base(p), ".", "_"))
			addedManifestItems = append(addedManifestItems, ManifestItem{
				ID:        newID,
				Href:      relativeZipPath(ctx.OPFPath, p),
				FullPath:  p,
				MediaType: contentTypeFor(p),
			})
			logs = append(logs, fmt.Sprintf("[Manifest] Đã khai báo file chưa có trong manifest: %s (ID: %s)", p, newID))
		}
	}

	validSpineRefs := make([]SpineRef, 0, len(ctx.Spine))
	for _, ref := range ctx.Spine {
		item, existsInManifest := ctx.ManifestByID[ref.IDRef]
		if !existsInManifest {
			if selected.has("REMOVE_MISSING_MANIFEST_ITEMS") {
				logs = append(logs, fmt.Sprintf("[Spine] Đã loại bỏ itemref trỏ tới manifest ID không tồn tại: %s", ref.IDRef))
				continue
			}
			validSpineRefs = append(validSpineRefs, ref)
			continue
		}
		if removedManifestIDs[item.ID] {
			logs = append(logs, fmt.Sprintf("[Spine] Đã loại bỏ itemref trỏ tới file không tồn tại: %s", item.Href))
			continue
		}
		validSpineRefs = append(validSpineRefs, ref)
	}

	if selected.has("FIX_XHTML") || selected.has("CLEAN_BROKEN_CONTENT_LINKS") {
		repairContentDocuments(ctx, selected, editedFiles, removedManifestIDs, &logs)
	}

	ncxPath := ""
	if ctx.NCX != nil {
		ncxPath = ctx.NCX.FullPath
	}
	if selected.has("FIX_TOC_NCX") {
		repairNCX(ctx, validSpineRefs, editedFiles, removedManifestIDs, &logs)
		if ctx.NCX != nil {
			ncxPath = ctx.NCX.FullPath
		} else {
			ncxPath = resolveZipHref(ctx.OPFDir, "toc.ncx")
		}
	}

	opfContent := ctx.OPFXML
	opfChanged := false

	if selected.has("UPGRADE_EPUB3") {
		nextOPF := ensureOPFVersion3(opfContent)
		if nextOPF != opfContent {
			opfContent = nextOPF
			opfChanged = true
			logs = append(logs, "[OPF] Đã nâng package version lên EPUB 3.0.")
		}

		nextOPF = ensureDCTermsModified(opfContent)
		if nextOPF != opfContent {
			opfContent = nextOPF
			opfChanged = true
			logs = append(logs, "[OPF] Đã bổ sung metadata dcterms:modified.")
		}

		if !ctx.hasNavDocument() {
			navPath := uniqueRepairZipPath(ctx, editedFiles, resolveZipHref(ctx.OPFDir, "nav.xhtml"))
			navID := uniqueRepairManifestID(ctx, addedManifestItems, "nav")
			addedManifestItems = append(addedManifestItems, ManifestItem{
				ID:        navID,
				Href:      relativeZipPath(ctx.OPFPath, navPath),
				FullPath:  navPath,
				MediaType: "application/xhtml+xml",
				Attrs:     map[string]string{"properties": "nav"},
			})
			editedFiles[navPath] = []byte(ctx.buildNavDocument(navPath, validSpineRefs))
			opfChanged = true
			logs = append(logs, "[NAV] Đã tạo nav.xhtml cho EPUB 3.")
		}
	}

	if selected.has("BUILD_COVER_PAGE") {
		if ensureCoverPage(ctx, editedFiles, &addedManifestItems, &validSpineRefs, &logs) {
			opfChanged = true
		}
	}

	if selected.has("BUILD_TOC_PAGE") {
		if ensureVisibleTOCPage(ctx, editedFiles, &addedManifestItems, &validSpineRefs, &logs) {
			opfChanged = true
		}
	}

	if selected.has("BUILD_CHAPTER_TITLES") {
		repairChapterTitles(ctx, editedFiles, &logs)
	}

	if selected.has("BUILD_TOC_PAGE") || selected.has("BUILD_COVER_PAGE") {
		rebuildVisibleTOCDocuments(ctx, validSpineRefs, editedFiles, &logs)
		rebuildNavDocuments(ctx, validSpineRefs, editedFiles, &logs)
	}

	if selected.has("FIX_TOC_NCX") && ncxPath != "" {
		hasNCXDecl := false
		for _, item := range ctx.Manifest {
			if item.ID == "ncx" || item.MediaType == "application/x-dtbncx+xml" || strings.HasSuffix(strings.ToLower(item.FullPath), ".ncx") {
				hasNCXDecl = true
				break
			}
		}
		if !hasNCXDecl {
			addedManifestItems = append(addedManifestItems, ManifestItem{
				ID:        uniqueRepairManifestID(ctx, addedManifestItems, "ncx"),
				Href:      relativeZipPath(ctx.OPFPath, ncxPath),
				FullPath:  ncxPath,
				MediaType: "application/x-dtbncx+xml",
			})
			opfChanged = true
			logs = append(logs, "[Mục lục] Đã khai báo NCX trong manifest.")
		}
		spineStartMatch := regexp.MustCompile(`(?i)<spine\b[^>]*>`).FindString(opfContent)
		if spineStartMatch != "" {
			attrs := parseAttrs(spineStartMatch)
			if attrs["toc"] == "" {
				opfContent = strings.Replace(opfContent, spineStartMatch, `<spine toc="ncx">`, 1)
				opfChanged = true
				logs = append(logs, "[Mục lục] Đã gắn spine toc=\"ncx\".")
			}
		}
	}

	if selected.has("REMOVE_MISSING_MANIFEST_ITEMS") ||
		selected.has("FIX_MEDIA_TYPES") ||
		selected.has("ADD_UNMANIFESTED_FILES") ||
		selected.has("FIX_TOC_NCX") ||
		selected.has("UPGRADE_EPUB3") ||
		selected.has("BUILD_TOC_PAGE") ||
		selected.has("BUILD_COVER_PAGE") {
		nextOPF := rebuildOPFManifestAndSpine(ctx, opfContent, validSpineRefs, removedManifestIDs, correctedMediaTypes, addedManifestItems)
		if nextOPF != opfContent {
			opfContent = nextOPF
			opfChanged = true
		}
	}

	if opfChanged {
		editedFiles[ctx.OPFPath] = []byte(opfContent)
	}

	normalizeMimetype := selected.has("PACKAGE_MIMETYPE")
	if len(editedFiles) == 0 && !normalizeMimetype {
		if len(logs) == 0 {
			logs = append(logs, "Không có thay đổi nào cho các mục đã chọn.")
		}
		return models.RepairResponse{
			Success:  true,
			Logs:     logs,
			Analysis: ctx.Analysis(),
			Report:   ctx.Validate(),
		}, nil
	}

	if err := s.pushUndoSnapshot(id); err != nil {
		return models.RepairResponse{}, err
	}
	tmp := ctx.FilePath + ".tmp"
	out, err := os.Create(tmp)
	if err != nil {
		return models.RepairResponse{}, err
	}
	bufOut := bufio.NewWriterSize(out, 2*1024*1024)
	zw := zip.NewWriter(bufOut)
	copyBuf := make([]byte, 1024*1024)

	if normalizeMimetype {
		header := &zip.FileHeader{Name: "mimetype", Method: zip.Store}
		header.SetMode(0644)
		w, err := zw.CreateHeader(header)
		if err != nil {
			return closeRepairZipErr(zw, out, tmp, err)
		}
		if _, err := w.Write([]byte("application/epub+zip")); err != nil {
			return closeRepairZipErr(zw, out, tmp, err)
		}
		logs = append(logs, "[Mimetype] Đã chuẩn hóa mimetype ở vị trí đầu file và không nén.")
	}

	written := map[string]bool{}
	if normalizeMimetype {
		written["mimetype"] = true
	}
	for _, f := range ctx.Reader.File {
		if f.FileInfo().IsDir() || written[f.Name] {
			continue
		}

		if content, ok := editedFiles[f.Name]; ok {
			header := &zip.FileHeader{Name: f.Name, Method: zip.Deflate}
			header.SetMode(f.Mode())
			writer, err := zw.CreateHeader(header)
			if err != nil {
				return closeRepairZipErr(zw, out, tmp, err)
			}
			if _, err := writer.Write(content); err != nil {
				return closeRepairZipErr(zw, out, tmp, err)
			}
		} else {
			if err := copyZipEntry(zw, f, copyBuf); err != nil {
				return closeRepairZipErr(zw, out, tmp, err)
			}
		}
		written[f.Name] = true
	}

	for path, content := range editedFiles {
		if written[path] {
			continue
		}
		header := &zip.FileHeader{Name: path, Method: zip.Deflate}
		header.SetMode(0644)
		writer, err := zw.CreateHeader(header)
		if err != nil {
			return closeRepairZipErr(zw, out, tmp, err)
		}
		if _, err := writer.Write(content); err != nil {
			return closeRepairZipErr(zw, out, tmp, err)
		}
		written[path] = true
	}

	if err := zw.Close(); err != nil {
		_ = out.Close()
		_ = os.Remove(tmp)
		return models.RepairResponse{}, err
	}
	if err := bufOut.Flush(); err != nil {
		_ = out.Close()
		_ = os.Remove(tmp)
		return models.RepairResponse{}, err
	}
	if err := out.Close(); err != nil {
		_ = os.Remove(tmp)
		return models.RepairResponse{}, err
	}

	if err := replaceBookFileWithTemp(id, ctx, tmp); err != nil {
		return models.RepairResponse{}, err
	}

	newCtx, err := loadBook(id)
	if err != nil {
		return models.RepairResponse{}, err
	}
	defer newCtx.Close()

	if len(logs) == 0 {
		logs = append(logs, "Không có thay đổi nào cho các mục đã chọn.")
	}

	return models.RepairResponse{
		Success:  true,
		Logs:     logs,
		Analysis: newCtx.Analysis(),
		Report:   newCtx.Validate(),
	}, nil
}

func repairChapterTitles(ctx *BookContext, editedFiles map[string][]byte, logs *[]string) {
	reBody := regexp.MustCompile(`(?i)(<body[^>]*>)`)

	for _, ch := range ctx.Chapters {
		lowerPath := strings.ToLower(ch.Path)
		if !strings.HasSuffix(lowerPath, ".xhtml") && !strings.HasSuffix(lowerPath, ".html") && !strings.HasSuffix(lowerPath, ".htm") {
			continue
		}
		if isCoverPage(ch) {
			continue
		}

		var htmlStr string
		var errRead error
		if edited, ok := editedFiles[ch.Path]; ok {
			htmlStr = string(edited)
		} else {
			htmlStr, errRead = ctx.readText(ch.Path)
			if errRead != nil {
				continue
			}
		}

		if !isChapterTitleMissing(htmlStr) {
			continue
		}

		bodyMatch := reBody.FindStringSubmatchIndex(htmlStr)
		if len(bodyMatch) >= 2 {
			bodyTagEnd := bodyMatch[1]
			title := ch.Title
			if title == "" {
				title = fmt.Sprintf("Chương %d", ch.Index+1)
			}
			heading := fmt.Sprintf("\n  <h2>%s</h2>", escapeXML(title))
			newHtml := htmlStr[:bodyTagEnd] + heading + htmlStr[bodyTagEnd:]
			editedFiles[ch.Path] = []byte(newHtml)
			*logs = append(*logs, fmt.Sprintf("[Tiêu đề] Đã bổ sung tiêu đề <h2> vào chương: %s (%s)", title, ch.Href))
		}
	}
}

func repairContentDocuments(ctx *BookContext, selected repairSelection, editedFiles map[string][]byte, removedManifestIDs map[string]bool, logs *[]string) {
	reTags := regexp.MustCompile(`(?i)<(br|hr|img|link|meta)\b([^>]*?)>`)
	reHtml := regexp.MustCompile(`(?i)<html\b([^>]*?)>`)

	for _, item := range ctx.Manifest {
		if removedManifestIDs[item.ID] {
			continue
		}
		lowerPath := strings.ToLower(item.FullPath)
		if !strings.HasSuffix(lowerPath, ".xhtml") && !strings.HasSuffix(lowerPath, ".html") && !strings.HasSuffix(lowerPath, ".htm") {
			continue
		}

		var htmlStr string
		var errRead error
		if edited, ok := editedFiles[item.FullPath]; ok {
			htmlStr = string(edited)
		} else {
			htmlStr, errRead = ctx.readText(item.FullPath)
			if errRead != nil {
				continue
			}
		}

		originalHTML := htmlStr
		fixedHTML := originalHTML
		xmlFixCount := 0

		if selected.has("FIX_XHTML") {
			fixedHTML = reTags.ReplaceAllStringFunc(fixedHTML, func(m string) string {
				trimmed := strings.TrimSpace(m)
				if strings.HasSuffix(trimmed, "/>") {
					return m
				}
				tagBody := strings.TrimSpace(strings.TrimSuffix(m[1:len(m)-1], "/"))
				xmlFixCount++
				return "<" + tagBody + " />"
			})

			fixedHTML = reHtml.ReplaceAllStringFunc(fixedHTML, func(m string) string {
				if strings.Contains(m, "xmlns=") {
					return m
				}
				tagBody := m[1 : len(m)-1]
				xmlFixCount++
				return "<" + tagBody + ` xmlns="http://www.w3.org/1999/xhtml">`
			})

			var entityFixCount int
			fixedHTML, entityFixCount = repairXHTMLEntities(fixedHTML)
			xmlFixCount += entityFixCount
		}

		if selected.has("CLEAN_BROKEN_CONTENT_LINKS") {
			cleanedHTML, cleanLogs := cleanHTMLTOC(ctx, item.FullPath, fixedHTML)
			if len(cleanLogs) > 0 {
				fixedHTML = cleanedHTML
				*logs = append(*logs, cleanLogs...)
			}

			cleanedHTML, cleanLogs = cleanBrokenAnchorHrefs(ctx, item.FullPath, fixedHTML)
			if len(cleanLogs) > 0 {
				fixedHTML = cleanedHTML
				*logs = append(*logs, cleanLogs...)
			}

			cleanedHTML, cleanLogs = cleanBrokenImages(ctx, item.FullPath, fixedHTML)
			if len(cleanLogs) > 0 {
				fixedHTML = cleanedHTML
				*logs = append(*logs, cleanLogs...)
			}
		}

		if fixedHTML != originalHTML {
			editedFiles[item.FullPath] = []byte(fixedHTML)
			if xmlFixCount > 0 {
				*logs = append(*logs, fmt.Sprintf("[XHTML] Đã sửa %d lỗi cú pháp XML trong %s", xmlFixCount, item.Href))
			}
		}
	}
}

var xhtmlNamedEntityReplacements = map[string]string{
	"nbsp":   "&#160;",
	"copy":   "&#169;",
	"reg":    "&#174;",
	"trade":  "&#8482;",
	"ndash":  "&#8211;",
	"mdash":  "&#8212;",
	"hellip": "&#8230;",
	"lsquo":  "&#8216;",
	"rsquo":  "&#8217;",
	"ldquo":  "&#8220;",
	"rdquo":  "&#8221;",
	"laquo":  "&#171;",
	"raquo":  "&#187;",
	"middot": "&#183;",
	"bull":   "&#8226;",
	"times":  "&#215;",
	"divide": "&#247;",
	"plusmn": "&#177;",
	"euro":   "&#8364;",
	"pound":  "&#163;",
	"yen":    "&#165;",
}

func repairXHTMLEntities(input string) (string, int) {
	fixCount := 0
	entityRe := regexp.MustCompile(`&(#\d+|#x[0-9a-fA-F]+|[A-Za-z][A-Za-z0-9]+);`)
	fixed := entityRe.ReplaceAllStringFunc(input, func(entity string) string {
		name := strings.TrimSuffix(strings.TrimPrefix(entity, "&"), ";")
		lowerName := strings.ToLower(name)
		if strings.HasPrefix(lowerName, "#") {
			return entity
		}
		switch lowerName {
		case "amp", "lt", "gt", "quot", "apos":
			return entity
		}
		if replacement, ok := xhtmlNamedEntityReplacements[lowerName]; ok {
			fixCount++
			return replacement
		}
		fixCount++
		return "&amp;" + name + ";"
	})

	var bareAmpFixCount int
	fixed, bareAmpFixCount = escapeBareAmpersands(fixed)
	fixCount += bareAmpFixCount

	return fixed, fixCount
}

func escapeBareAmpersands(input string) (string, int) {
	var b strings.Builder
	fixCount := 0
	for i := 0; i < len(input); i++ {
		if input[i] == '&' && !hasValidXMLCharacterReferenceAt(input, i) {
			b.WriteString("&amp;")
			fixCount++
			continue
		}
		b.WriteByte(input[i])
	}
	if fixCount == 0 {
		return input, 0
	}
	return b.String(), fixCount
}

func hasValidXMLCharacterReferenceAt(input string, index int) bool {
	rest := input[index:]
	for _, entity := range []string{"&amp;", "&lt;", "&gt;", "&quot;", "&apos;"} {
		if strings.HasPrefix(rest, entity) {
			return true
		}
	}

	if strings.HasPrefix(rest, "&#x") || strings.HasPrefix(rest, "&#X") {
		pos := index + 3
		start := pos
		for pos < len(input) && isHexDigit(input[pos]) {
			pos++
		}
		return pos > start && pos < len(input) && input[pos] == ';'
	}
	if strings.HasPrefix(rest, "&#") {
		pos := index + 2
		start := pos
		for pos < len(input) && input[pos] >= '0' && input[pos] <= '9' {
			pos++
		}
		return pos > start && pos < len(input) && input[pos] == ';'
	}
	return false
}

func isHexDigit(ch byte) bool {
	return (ch >= '0' && ch <= '9') || (ch >= 'a' && ch <= 'f') || (ch >= 'A' && ch <= 'F')
}

func cleanBrokenAnchorHrefs(ctx *BookContext, htmlPath, htmlContent string) (string, []string) {
	var logs []string
	baseDir := posixDir(htmlPath)
	reAnchor := regexp.MustCompile(`(?is)<a\b[^>]*\bhref\s*=\s*["']([^"']*)["'][^>]*>`)
	reHref := regexp.MustCompile(`(?is)\s+href\s*=\s*["'][^"']*["']`)

	cleanedHTML := reAnchor.ReplaceAllStringFunc(htmlContent, func(anchor string) string {
		m := reAnchor.FindStringSubmatch(anchor)
		if len(m) < 2 {
			return anchor
		}
		href := strings.TrimSpace(m[1])
		if skipLocalReference(href) {
			return anchor
		}
		resolved := resolveZipHref(baseDir, href)
		if resolved == "" || ctx.Entries[resolved] != nil {
			return anchor
		}
		logs = append(logs, fmt.Sprintf("[Nội dung] Đã bỏ href hỏng trong %s: %s", htmlPath, href))
		return reHref.ReplaceAllString(anchor, "")
	})

	return cleanedHTML, logs
}

func rebuildVisibleTOCDocuments(ctx *BookContext, validSpineRefs []SpineRef, editedFiles map[string][]byte, logs *[]string) {
	for _, ref := range validSpineRefs {
		item, ok := ctx.ManifestByID[ref.IDRef]
		if !ok || !isVisibleTOCPage(item) {
			continue
		}
		nextHTML := ctx.buildVisibleTOCDocument(item.FullPath, validSpineRefs)
		currentHTML := ""
		if edited, ok := editedFiles[item.FullPath]; ok {
			currentHTML = string(edited)
		} else if text, err := ctx.readText(item.FullPath); err == nil {
			currentHTML = text
		}
		if strings.TrimSpace(currentHTML) == strings.TrimSpace(nextHTML) {
			continue
		}
		editedFiles[item.FullPath] = []byte(nextHTML)
		*logs = append(*logs, fmt.Sprintf("[Mục lục] Đã dựng lại trang TOC hiển thị từ spine: %s", item.FullPath))
	}
}

func rebuildNavDocuments(ctx *BookContext, validSpineRefs []SpineRef, editedFiles map[string][]byte, logs *[]string) {
	for _, item := range ctx.Manifest {
		if !hasPropertyToken(item.Attrs["properties"], "nav") || ctx.Entries[item.FullPath] == nil {
			continue
		}
		nextHTML := ctx.buildNavDocument(item.FullPath, validSpineRefs)
		currentHTML := ""
		if edited, ok := editedFiles[item.FullPath]; ok {
			currentHTML = string(edited)
		} else if text, err := ctx.readText(item.FullPath); err == nil {
			currentHTML = text
		}
		if strings.TrimSpace(currentHTML) == strings.TrimSpace(nextHTML) {
			continue
		}
		editedFiles[item.FullPath] = []byte(nextHTML)
		*logs = append(*logs, fmt.Sprintf("[NAV] Đã dựng lại nav.xhtml từ spine: %s", item.FullPath))
	}
}

func ensureVisibleTOCPage(ctx *BookContext, editedFiles map[string][]byte, addedManifestItems *[]ManifestItem, validSpineRefs *[]SpineRef, logs *[]string) bool {
	changed := false

	var tocItem ManifestItem
	if existing, ok := ctx.findVisibleTOCItem(); ok && existing != nil {
		tocItem = *existing
	} else {
		tocPath := uniqueRepairZipPath(ctx, editedFiles, normalizeZipPath(ctx.repairPageDir()+"toc.xhtml"))
		tocID := uniqueRepairManifestID(ctx, *addedManifestItems, "toc_page")
		tocItem = ManifestItem{
			ID:        tocID,
			Href:      relativeZipPath(ctx.OPFPath, tocPath),
			FullPath:  tocPath,
			MediaType: "application/xhtml+xml",
		}
		*addedManifestItems = append(*addedManifestItems, tocItem)
		changed = true
		*logs = append(*logs, fmt.Sprintf("[TOC] Đã tạo trang mục lục hiển thị: %s", tocPath))
	}

	nextHTML := ctx.buildVisibleTOCDocument(tocItem.FullPath, *validSpineRefs)
	currentHTML := ""
	if edited, ok := editedFiles[tocItem.FullPath]; ok {
		currentHTML = string(edited)
	} else if text, err := ctx.readText(tocItem.FullPath); err == nil {
		currentHTML = text
	}
	if strings.TrimSpace(currentHTML) != strings.TrimSpace(nextHTML) {
		editedFiles[tocItem.FullPath] = []byte(nextHTML)
		changed = true
		*logs = append(*logs, fmt.Sprintf("[TOC] Đã dựng lại nội dung trang mục lục: %s", tocItem.FullPath))
	}

	if ensureSpineRefAfterCover(ctx, validSpineRefs, tocItem.ID) {
		changed = true
		*logs = append(*logs, "[Spine] Đã đưa trang mục lục vào reading order.")
	}

	return changed
}

func ensureCoverPage(ctx *BookContext, editedFiles map[string][]byte, addedManifestItems *[]ManifestItem, validSpineRefs *[]SpineRef, logs *[]string) bool {
	coverImage := ctx.findCoverImageItem()
	if coverImage == nil {
		*logs = append(*logs, "[Cover] Không tìm thấy ảnh bìa trong manifest để tạo trang cover.")
		return false
	}

	changed := false
	var coverPage ManifestItem
	if existing, ok := ctx.findCoverPageItem(); ok && existing != nil {
		coverPage = *existing
	} else {
		coverPath := uniqueRepairZipPath(ctx, editedFiles, normalizeZipPath(ctx.repairPageDir()+"cover.xhtml"))
		coverID := uniqueRepairManifestID(ctx, *addedManifestItems, "cover_page")
		coverPage = ManifestItem{
			ID:        coverID,
			Href:      relativeZipPath(ctx.OPFPath, coverPath),
			FullPath:  coverPath,
			MediaType: "application/xhtml+xml",
		}
		*addedManifestItems = append(*addedManifestItems, coverPage)
		changed = true
		*logs = append(*logs, fmt.Sprintf("[Cover] Đã tạo trang cover: %s", coverPath))
	}

	nextHTML := buildCoverPageDocument(coverPage.FullPath, coverImage.FullPath, ctx.Title)
	currentHTML := ""
	if edited, ok := editedFiles[coverPage.FullPath]; ok {
		currentHTML = string(edited)
	} else if text, err := ctx.readText(coverPage.FullPath); err == nil {
		currentHTML = text
	}
	if strings.TrimSpace(currentHTML) != strings.TrimSpace(nextHTML) {
		editedFiles[coverPage.FullPath] = []byte(nextHTML)
		changed = true
		*logs = append(*logs, fmt.Sprintf("[Cover] Đã dựng lại nội dung trang cover từ ảnh: %s", coverImage.FullPath))
	}

	if ensureSpineRefFirst(validSpineRefs, coverPage.ID) {
		changed = true
		*logs = append(*logs, "[Spine] Đã đưa trang cover lên đầu reading order.")
	}

	return changed
}

func buildCoverPageDocument(coverPagePath, coverImagePath, title string) string {
	if strings.TrimSpace(title) == "" {
		title = "Cover"
	}
	return fmt.Sprintf(`<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
  <title>Cover</title>
  <style type="text/css">
    html, body { margin: 0; padding: 0; background: #ffffff; }
    body { text-align: center; }
    .cover { margin: 0; padding: 0; text-align: center; }
    .cover img { max-width: 100%%; max-height: 100vh; height: auto; width: auto; }
  </style>
</head>
<body>
  <div class="cover">
    <img src="%s" alt="%s" />
  </div>
</body>
</html>`, escapeXML(relativeZipPath(coverPagePath, coverImagePath)), escapeXML(title))
}

func ensureSpineRefFirst(spine *[]SpineRef, id string) bool {
	return ensureSpineRefAt(spine, id, 0)
}

func ensureSpineRefAfterCover(ctx *BookContext, spine *[]SpineRef, id string) bool {
	targetIndex := 0
	foundCover := false
	for _, ref := range *spine {
		if ref.IDRef == id {
			continue
		}
		if ctx.isCoverSpineRef(ref) {
			targetIndex++
			foundCover = true
			break
		}
		targetIndex++
	}
	if !foundCover {
		targetIndex = 0
	}
	return ensureSpineRefAt(spine, id, targetIndex)
}

func ensureSpineRefAt(spine *[]SpineRef, id string, targetIndex int) bool {
	if id == "" {
		return false
	}
	nextRef := SpineRef{IDRef: id, Linear: true}
	oldIndex := -1
	without := make([]SpineRef, 0, len(*spine))
	for idx, ref := range *spine {
		if ref.IDRef == id {
			if oldIndex == -1 {
				nextRef = ref
				oldIndex = idx
			}
			continue
		}
		without = append(without, ref)
	}
	if targetIndex < 0 {
		targetIndex = 0
	}
	if targetIndex > len(without) {
		targetIndex = len(without)
	}
	if oldIndex == targetIndex {
		return false
	}
	without = append(without, SpineRef{})
	copy(without[targetIndex+1:], without[targetIndex:])
	without[targetIndex] = nextRef
	*spine = without
	return true
}

func (ctx *BookContext) repairPageDir() string {
	if len(ctx.Chapters) > 0 {
		if dir := posixDir(ctx.Chapters[0].Path); dir != "" {
			return dir
		}
	}
	return ctx.OPFDir
}

func (ctx *BookContext) findVisibleTOCItem() (*ManifestItem, bool) {
	var fallback *ManifestItem
	for _, item := range ctx.Manifest {
		copy := item
		if !isVisibleTOCPage(copy) {
			continue
		}
		if ctx.spineUsesID(copy.ID) {
			return &copy, true
		}
		if fallback == nil {
			fallback = &copy
		}
	}
	return fallback, fallback != nil
}

func (ctx *BookContext) findCoverPageItem() (*ManifestItem, bool) {
	var fallback *ManifestItem
	for _, item := range ctx.Manifest {
		copy := item
		if !isCoverPageItem(copy) {
			continue
		}
		if ctx.spineUsesID(copy.ID) {
			return &copy, true
		}
		if fallback == nil {
			fallback = &copy
		}
	}
	return fallback, fallback != nil
}

func (ctx *BookContext) findCoverImageItem() *ManifestItem {
	if coverID := ctx.coverID(); coverID != "" {
		if item, ok := ctx.ManifestByID[coverID]; ok && isImageManifestItem(item) && ctx.Entries[item.FullPath] != nil {
			copy := item
			return &copy
		}
	}
	var firstImage *ManifestItem
	for _, item := range ctx.Manifest {
		if !isImageManifestItem(item) || ctx.Entries[item.FullPath] == nil {
			continue
		}
		copy := item
		lower := strings.ToLower(item.ID + " " + item.Href + " " + item.FullPath)
		if strings.Contains(lower, "cover") || strings.Contains(lower, "title") || strings.Contains(lower, "front") || strings.Contains(lower, "folder") {
			return &copy
		}
		if firstImage == nil {
			firstImage = &copy
		}
	}
	return firstImage
}

func (ctx *BookContext) spineUsesID(id string) bool {
	return spineUsesID(ctx.Spine, id)
}

func (ctx *BookContext) isCoverSpineRef(ref SpineRef) bool {
	if item, ok := ctx.ManifestByID[ref.IDRef]; ok {
		return isCoverPageItem(item)
	}
	lower := strings.ToLower(ref.IDRef)
	return strings.Contains(lower, "cover") || strings.Contains(lower, "titlepage")
}

func isImageManifestItem(item ManifestItem) bool {
	return strings.HasPrefix(strings.ToLower(item.MediaType), "image/") ||
		strings.HasPrefix(strings.ToLower(contentTypeFor(item.FullPath)), "image/")
}

func isCoverPageItem(item ManifestItem) bool {
	if !isHTMLManifestItem(item) || hasPropertyToken(item.Attrs["properties"], "nav") {
		return false
	}
	lower := strings.ToLower(item.ID + " " + item.Href + " " + item.FullPath)
	base := strings.ToLower(filepath.Base(item.FullPath))
	return strings.Contains(lower, "titlepage") ||
		strings.Contains(lower, "cover") ||
		base == "title.xhtml" ||
		base == "title.html"
}

func isVisibleTOCPage(item ManifestItem) bool {
	if !isHTMLManifestItem(item) || hasPropertyToken(item.Attrs["properties"], "nav") {
		return false
	}
	if isCoverPageItem(item) {
		return false
	}
	base := strings.ToLower(filepath.Base(item.FullPath))
	return base == "index.html" || base == "index.xhtml" || base == "toc.html" || base == "toc.xhtml"
}

func (ctx *BookContext) buildVisibleTOCDocument(tocPath string, spineRefs []SpineRef) string {
	var links strings.Builder
	for _, ref := range spineRefs {
		item, ok := ctx.ManifestByID[ref.IDRef]
		if !ok || !isHTMLManifestItem(item) || item.FullPath == tocPath || hasPropertyToken(item.Attrs["properties"], "nav") || isCoverPageItem(item) {
			continue
		}
		title := ctx.chapterTitleForItem(ref.IDRef, item)
		links.WriteString(fmt.Sprintf(`    <li><a href="%s">%s</a></li>`+"\n", escapeXML(relativeZipPath(tocPath, item.FullPath)), escapeXML(title)))
	}
	title := ctx.Title
	if title == "" {
		title = strings.TrimSuffix(ctx.FileName, filepath.Ext(ctx.FileName))
	}
	return fmt.Sprintf(`<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
  <title>%s</title>
</head>
<body>
  <h1>%s</h1>
  <nav id="toc">
    <ol>
%s    </ol>
  </nav>
</body>
</html>`, escapeXML(title), escapeXML(title), links.String())
}

func (ctx *BookContext) chapterTitleForItem(idref string, item ManifestItem) string {
	for _, ch := range ctx.Chapters {
		if ch.IDRef == idref && ch.Title != "" {
			return ch.Title
		}
	}
	if title := ctx.htmlTitle(item.FullPath); title != "" {
		return title
	}
	return item.Href
}

func repairNCX(ctx *BookContext, validSpineRefs []SpineRef, editedFiles map[string][]byte, removedManifestIDs map[string]bool, logs *[]string) {
	ncxPath := resolveZipHref(ctx.OPFDir, "toc.ncx")
	var ncxContent string
	if ctx.NCX != nil {
		ncxPath = ctx.NCX.FullPath
		if data, err := ctx.readText(ncxPath); err == nil {
			ncxContent = data
		}
	}

	if ncxContent == "" || validateXMLWellFormed(ncxContent) != nil {
		tocPoints := tocFromSpine(ctx, ncxPath, validSpineRefs)
		editedFiles[ncxPath] = []byte(ctx.rebuildNCXFromTOC(ncxPath, tocPoints, ctx.Title))
		*logs = append(*logs, "[Mục lục] Đã dựng lại file NCX mới từ danh sách chương do file cũ bị lỗi cú pháp XML hoặc bị trống.")
		return
	}

	var updatedTOC []TocPoint
	tocFixedCount := 0
	for _, point := range ctx.TOC {
		resolved := resolveZipHref(posixDir(ncxPath), point.Src)
		if resolved == "" {
			tocFixedCount++
			*logs = append(*logs, fmt.Sprintf("[Mục lục] Đã xóa mục liên kết rỗng: %s", point.Title))
			continue
		}
		targetItem, ok := ctx.ManifestByPath[resolved]
		if !ok || removedManifestIDs[targetItem.ID] {
			tocFixedCount++
			*logs = append(*logs, fmt.Sprintf("[Mục lục] Đã loại bỏ liên kết hỏng: %s -> %s", point.Title, point.Src))
			continue
		}

		title := point.Title
		if title == "" || strings.HasPrefix(strings.ToLower(title), "chapter") || strings.HasSuffix(strings.ToLower(title), ".xhtml") || strings.HasSuffix(strings.ToLower(title), ".html") {
			if htmlTitle := ctx.htmlTitle(resolved); htmlTitle != "" && htmlTitle != title {
				tocFixedCount++
				*logs = append(*logs, fmt.Sprintf("[Mục lục] Đã cập nhật tiêu đề chương: %q -> %q", title, htmlTitle))
				title = htmlTitle
			}
		}
		updatedTOC = append(updatedTOC, TocPoint{Title: title, Src: point.Src, FullPath: resolved})
	}

	var deduplicatedTOC []TocPoint
	for i, pt := range updatedTOC {
		if i > 0 && deduplicatedTOC[len(deduplicatedTOC)-1].Src == pt.Src && deduplicatedTOC[len(deduplicatedTOC)-1].Title == pt.Title {
			tocFixedCount++
			*logs = append(*logs, fmt.Sprintf("[Mục lục] Đã loại bỏ liên kết trùng lặp: %s", pt.Title))
			continue
		}
		deduplicatedTOC = append(deduplicatedTOC, pt)
	}

	if tocFixedCount > 0 {
		ncxContent = ctx.rebuildNCXFromTOC(ncxPath, deduplicatedTOC, ctx.Title)
	}

	renumberedNCX := renumberPlayOrder(ncxContent)
	if renumberedNCX != ncxContent {
		ncxContent = renumberedNCX
		*logs = append(*logs, "[Mục lục] Đã chuẩn hóa playOrder trong NCX.")
	}

	if tocFixedCount > 0 || renumberedNCX != "" {
		editedFiles[ncxPath] = []byte(ncxContent)
	}
}

func closeRepairZipErr(zw *zip.Writer, out *os.File, tmp string, err error) (models.RepairResponse, error) {
	_ = zw.Close()
	_ = out.Close()
	_ = os.Remove(tmp)
	return models.RepairResponse{}, err
}

func rebuildOPFManifestAndSpine(ctx *BookContext, opfContent string, validSpineRefs []SpineRef, removedManifestIDs map[string]bool, correctedMediaTypes map[string]string, addedManifestItems []ManifestItem) string {
	var updatedManifestItems []string
	for _, item := range ctx.Manifest {
		if removedManifestIDs[item.ID] {
			continue
		}
		mediaType := item.MediaType
		if correctedMediaType, ok := correctedMediaTypes[item.ID]; ok {
			mediaType = correctedMediaType
		}
		var sb strings.Builder
		sb.WriteString(fmt.Sprintf(`<item id="%s" href="%s" media-type="%s"`, escapeXML(item.ID), escapeXML(item.Href), escapeXML(mediaType)))
		for k, v := range item.Attrs {
			if k != "id" && k != "href" && k != "media-type" {
				sb.WriteString(fmt.Sprintf(` %s="%s"`, k, escapeXML(v)))
			}
		}
		sb.WriteString(" />")
		updatedManifestItems = append(updatedManifestItems, "    "+sb.String())
	}
	for _, item := range addedManifestItems {
		var sb strings.Builder
		sb.WriteString(fmt.Sprintf(`<item id="%s" href="%s" media-type="%s"`, escapeXML(item.ID), escapeXML(item.Href), escapeXML(item.MediaType)))
		for k, v := range item.Attrs {
			sb.WriteString(fmt.Sprintf(` %s="%s"`, k, escapeXML(v)))
		}
		sb.WriteString(" />")
		updatedManifestItems = append(updatedManifestItems, "    "+sb.String())
	}
	opfContent = replaceXMLBlock(manifestRe, opfContent, strings.Join(updatedManifestItems, "\n"))

	var updatedSpineRefs []string
	for _, ref := range validSpineRefs {
		var sb strings.Builder
		sb.WriteString(fmt.Sprintf(`<itemref idref="%s"`, escapeXML(ref.IDRef)))
		if !ref.Linear {
			sb.WriteString(` linear="no"`)
		}
		for k, v := range ref.Attrs {
			if k != "idref" && k != "linear" {
				sb.WriteString(fmt.Sprintf(` %s="%s"`, k, escapeXML(v)))
			}
		}
		sb.WriteString(" />")
		updatedSpineRefs = append(updatedSpineRefs, "    "+sb.String())
	}
	return replaceXMLBlock(spineRe, opfContent, strings.Join(updatedSpineRefs, "\n"))
}

func ensureOPFVersion3(opfContent string) string {
	rePackage := regexp.MustCompile(`(?is)<package\b[^>]*>`)
	return rePackage.ReplaceAllStringFunc(opfContent, func(tag string) string {
		reVersion := regexp.MustCompile(`(?is)\sversion\s*=\s*["'][^"']*["']`)
		if reVersion.MatchString(tag) {
			return reVersion.ReplaceAllString(tag, ` version="3.0"`)
		}
		return strings.TrimSuffix(tag, ">") + ` version="3.0">`
	})
}

func ensureDCTermsModified(opfContent string) string {
	if regexp.MustCompile(`(?is)<meta\b[^>]*property\s*=\s*["']dcterms:modified["'][^>]*>`).MatchString(opfContent) {
		return opfContent
	}
	meta := fmt.Sprintf("    <meta property=\"dcterms:modified\">%s</meta>\n", time.Now().UTC().Format("2006-01-02T15:04:05Z"))
	m := metadataRe.FindStringSubmatchIndex(opfContent)
	if len(m) < 8 {
		return opfContent
	}
	return opfContent[:m[5]] + "\n" + meta + opfContent[m[5]:]
}

func (ctx *BookContext) hasNavDocument() bool {
	for _, item := range ctx.Manifest {
		if hasPropertyToken(item.Attrs["properties"], "nav") {
			return true
		}
	}
	return false
}

func (ctx *BookContext) buildNavDocument(navPath string, spineRefs []SpineRef) string {
	var links strings.Builder
	for _, ref := range spineRefs {
		item, ok := ctx.ManifestByID[ref.IDRef]
		if !ok || !isHTMLManifestItem(item) {
			continue
		}
		title := item.Href
		for _, ch := range ctx.Chapters {
			if ch.IDRef == ref.IDRef && ch.Title != "" {
				title = ch.Title
				break
			}
		}
		links.WriteString(fmt.Sprintf(`      <li><a href="%s">%s</a></li>`+"\n", escapeXML(relativeZipPath(navPath, item.FullPath)), escapeXML(title)))
	}
	return fmt.Sprintf(`<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head>
  <title>Navigation</title>
</head>
<body>
  <nav epub:type="toc" id="toc">
    <h1>Mục lục</h1>
    <ol>
%s    </ol>
  </nav>
</body>
</html>`, links.String())
}

func tocFromSpine(ctx *BookContext, ncxPath string, spineRefs []SpineRef) []TocPoint {
	var tocPoints []TocPoint
	for _, ref := range spineRefs {
		item, ok := ctx.ManifestByID[ref.IDRef]
		if !ok || !isHTMLManifestItem(item) {
			continue
		}
		title := ctx.htmlTitle(item.FullPath)
		if title == "" {
			title = item.Href
		}
		tocPoints = append(tocPoints, TocPoint{
			Title:    title,
			Src:      relativeZipPath(ncxPath, item.FullPath),
			FullPath: item.FullPath,
		})
	}
	return tocPoints
}

func uniqueRepairManifestID(ctx *BookContext, added []ManifestItem, base string) string {
	base = sanitizeManifestID(base)
	candidate := base
	for i := 1; ; i++ {
		exists := false
		if _, ok := ctx.ManifestByID[candidate]; ok {
			exists = true
		}
		for _, item := range added {
			if item.ID == candidate {
				exists = true
				break
			}
		}
		if !exists {
			return candidate
		}
		candidate = fmt.Sprintf("%s_%d", base, i)
	}
}

func uniqueRepairZipPath(ctx *BookContext, editedFiles map[string][]byte, preferred string) string {
	if preferred == "" {
		preferred = "nav.xhtml"
	}
	ext := filepath.Ext(preferred)
	base := strings.TrimSuffix(preferred, ext)
	if ext == "" {
		ext = ".xhtml"
	}
	candidate := preferred
	for i := 1; ; i++ {
		if ctx.Entries[candidate] == nil && editedFiles[candidate] == nil {
			return candidate
		}
		candidate = fmt.Sprintf("%s_%d%s", base, i, ext)
	}
}

func spineUsesID(spine []SpineRef, id string) bool {
	for _, ref := range spine {
		if ref.IDRef == id {
			return true
		}
	}
	return false
}

func (ctx *BookContext) rebuildNCXFromTOC(ncxPath string, toc []TocPoint, title string) string {
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
	for i, pt := range toc {
		b.WriteString(fmt.Sprintf(`    <navPoint id="nav-%d" playOrder="%d">`+"\n", i+1, i+1))
		b.WriteString("      <navLabel><text>")
		b.WriteString(escapeXML(pt.Title))
		b.WriteString("</text></navLabel>\n")
		b.WriteString(`      <content src="`)
		b.WriteString(escapeXML(relativeZipPath(ncxPath, pt.FullPath)))
		b.WriteString(`"/>`)
		b.WriteString("\n")
		b.WriteString("    </navPoint>\n")
	}
	b.WriteString("  </navMap>\n</ncx>")
	return b.String()
}

func cleanHTMLTOC(ctx *BookContext, htmlPath, htmlContent string) (string, []string) {
	var logs []string
	baseDir := posixDir(htmlPath)

	reLi := regexp.MustCompile(`(?is)<li\b[^>]*>(.*?)</li>`)
	reA := regexp.MustCompile(`(?is)<a\b[^>]*\bhref\s*=\s*["']([^"']*)["'][^>]*>(.*?)</a>`)

	for _, tag := range []string{"section", "nav", "ul", "ol"} {
		reContainer := regexp.MustCompile(fmt.Sprintf(`(?is)<%s\b[^>]*>(.*?)</%s>`, tag, tag))
		htmlContent = reContainer.ReplaceAllStringFunc(htmlContent, func(container string) string {
			liMatches := reLi.FindAllString(container, -1)
			if len(liMatches) == 0 {
				return container
			}

			validLiCount := 0
			liKeep := make([]bool, len(liMatches))

			for idx, li := range liMatches {
				aMatches := reA.FindAllStringSubmatch(li, -1)
				if len(aMatches) == 0 {
					liKeep[idx] = true
					validLiCount++
					continue
				}

				liHasLocalLinks := false
				liHasValidLocalLink := false
				var linkTitle string

				for _, aMatch := range aMatches {
					href := aMatch[1]
					title := cleanText(stripTags(aMatch[2]))
					if title != "" {
						linkTitle = title
					}

					if isExternalRef(href) {
						continue
					}

					lowerHref := strings.ToLower(href)
					if strings.Contains(lowerHref, ".html") || strings.Contains(lowerHref, ".xhtml") || strings.Contains(lowerHref, ".htm") {
						liHasLocalLinks = true
						resolved := resolveZipHref(baseDir, href)
						if _, exists := ctx.Entries[resolved]; exists {
							liHasValidLocalLink = true
						}
					}
				}

				if liHasLocalLinks && !liHasValidLocalLink {
					if linkTitle != "" {
						logs = append(logs, fmt.Sprintf("[Nội dung] Đã xóa chương thừa khỏi trang danh sách: %s", linkTitle))
					}
					liKeep[idx] = false
					continue
				}

				liKeep[idx] = true
				validLiCount++
			}

			if validLiCount == 0 {
				volTitle := ""
				reVolTitle := regexp.MustCompile(`(?is)Tập\s+\d+[^<]*`)
				if m := reVolTitle.FindString(container); m != "" {
					volTitle = strings.TrimSpace(m)
				}
				if volTitle == "" {
					volTitle = "Phần nội dung trống"
				}
				logs = append(logs, fmt.Sprintf("[Nội dung] Đã ẩn phần danh mục không tồn tại: %s", volTitle))
				return ""
			}

			liCounter := 0
			newContainer := reLi.ReplaceAllStringFunc(container, func(oldLi string) string {
				keep := liKeep[liCounter]
				liCounter++
				if keep {
					return oldLi
				}
				return ""
			})

			return newContainer
		})
	}

	return htmlContent, logs
}

func cleanBrokenImages(ctx *BookContext, htmlPath, htmlContent string) (string, []string) {
	var logs []string
	baseDir := posixDir(htmlPath)

	// Regex for <img> tags
	reImg := regexp.MustCompile(`(?is)<img\b[^>]*>`)
	reSrc := regexp.MustCompile(`(?is)\bsrc\s*=\s*["']([^"']*)["']`)

	// Regex for <image> tags inside SVG (like <image xlink:href="..." /> or <image href="..." />)
	reSvgImage := regexp.MustCompile(`(?is)<image\b[^>]*>`)
	reHref := regexp.MustCompile(`(?is)\b(?:href|xlink:href)\s*=\s*["']([^"']*)["']`)

	// Regex for <link> tags (e.g. stylesheet links)
	reLink := regexp.MustCompile(`(?is)<link\b[^>]*>`)
	reLinkHref := regexp.MustCompile(`(?is)\bhref\s*=\s*["']([^"']*)["']`)


	cleanedHTML := reImg.ReplaceAllStringFunc(htmlContent, func(imgTag string) string {
		m := reSrc.FindStringSubmatch(imgTag)
		if len(m) < 2 {
			return imgTag
		}
		src := strings.TrimSpace(m[1])
		if skipLocalReference(src) {
			return imgTag
		}
		resolved := resolveZipHref(baseDir, src)
		if resolved == "" || ctx.Entries[resolved] != nil {
			return imgTag
		}
		logs = append(logs, fmt.Sprintf("[Nội dung] Đã xóa thẻ ảnh bị hỏng trong %s: %s", htmlPath, src))
		return ""
	})


	cleanedHTML = reSvgImage.ReplaceAllStringFunc(cleanedHTML, func(imgTag string) string {
		m := reHref.FindStringSubmatch(imgTag)
		if len(m) < 2 {
			return imgTag
		}
		href := strings.TrimSpace(m[1])
		if skipLocalReference(href) {
			return imgTag
		}
		resolved := resolveZipHref(baseDir, href)
		if resolved == "" || ctx.Entries[resolved] != nil {
			return imgTag
		}
		logs = append(logs, fmt.Sprintf("[Nội dung] Đã xóa ảnh SVG bị hỏng trong %s: %s", htmlPath, href))
		return "" 
	})

	cleanedHTML = reLink.ReplaceAllStringFunc(cleanedHTML, func(linkTag string) string {
		m := reLinkHref.FindStringSubmatch(linkTag)
		if len(m) < 2 {
			return linkTag
		}
		href := strings.TrimSpace(m[1])
		if skipLocalReference(href) {
			return linkTag
		}
		resolved := resolveZipHref(baseDir, href)
		if resolved == "" || ctx.Entries[resolved] != nil {
			return linkTag
		}
		logs = append(logs, fmt.Sprintf("[Nội dung] Đã xóa liên kết tài nguyên hỏng trong %s: %s", htmlPath, href))
		return ""
	})

	return cleanedHTML, logs
}
