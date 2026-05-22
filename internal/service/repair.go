package service

import (
	"archive/zip"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"epubforge/internal/models"
)

func (s *Service) Repair(id string) (models.RepairResponse, error) {
	lock := s.getBookLock(id)
	lock.Lock()
	defer lock.Unlock()

	ctx, err := loadBook(id)
	if err != nil {
		return models.RepairResponse{}, err
	}
	defer ctx.Close()

	var logs []string
	editedFiles := make(map[string][]byte)
	removedManifestIDs := make(map[string]bool)
	correctedMediaTypes := make(map[string]string)
	var addedManifestItems []ManifestItem
	for _, item := range ctx.Manifest {
		f, ok := ctx.Entries[item.FullPath]
		if !ok || f.FileInfo().IsDir() {
			isSpineItem := false
			for _, ref := range ctx.Spine {
				if ref.IDRef == item.ID {
					isSpineItem = true
					break
				}
			}
			removedManifestIDs[item.ID] = true
			if isSpineItem {
				logs = append(logs, fmt.Sprintf("[Spine] Phát hiện file chương bị thiếu, đã loại bỏ khỏi cấu trúc sách: %s (ID: %s)", item.Href, item.ID))
			} else {
				logs = append(logs, fmt.Sprintf("[Manifest] Đã loại bỏ tài nguyên bị thiếu khỏi manifest: %s (ID: %s)", item.Href, item.ID))
			}
		} else {
			correctMediaType := contentTypeFor(item.FullPath)
			if item.MediaType != correctMediaType {
				correctedMediaTypes[item.ID] = correctMediaType
				logs = append(logs, fmt.Sprintf("[Manifest] Đã sửa media-type cho %s: %s -> %s", item.Href, item.MediaType, correctMediaType))
			}
		}
	}

	for p, f := range ctx.Entries {
		if f.FileInfo().IsDir() {
			continue
		}
		lowerPath := strings.ToLower(p)
		if p == "mimetype" || p == "META-INF/container.xml" || p == ctx.OPFPath || lowerPath == "toc.ncx" || strings.HasSuffix(lowerPath, ".opf") || strings.HasSuffix(lowerPath, ".ncx") {
			continue
		}
		if _, ok := ctx.ManifestByPath[p]; !ok {
			if strings.HasSuffix(lowerPath, ".tmp") || strings.HasSuffix(lowerPath, ".bak") {
				continue
			}
			newID := "added_" + strings.ReplaceAll(filepath.Base(p), ".", "_")
			for {
				exists := false
				for _, mi := range ctx.Manifest {
					if mi.ID == newID {
						exists = true
						break
					}
				}
				if exists {
					newID += "_rand"
				} else {
					break
				}
			}
			addedManifestItems = append(addedManifestItems, ManifestItem{
				ID:        newID,
				Href:      relativeZipPath(ctx.OPFPath, p),
				FullPath:  p,
				MediaType: contentTypeFor(p),
			})
			logs = append(logs, fmt.Sprintf("[Manifest] Khai báo file chưa lập danh mục: %s (ID: %s)", p, newID))
		}
	}

	var validSpineRefs []SpineRef
	for _, ref := range ctx.Spine {
		item, existsInManifest := ctx.ManifestByID[ref.IDRef]
		if !existsInManifest {
			logs = append(logs, fmt.Sprintf("[Spine] Loại bỏ tham chiếu spine bị lỗi (không khai báo trong manifest): IDRef=%s", ref.IDRef))
			continue
		}
		if removedManifestIDs[item.ID] {
			logs = append(logs, fmt.Sprintf("[Spine] Loại bỏ tham chiếu spine bị lỗi (file không tồn tại): %s", item.Href))
			continue
		}
		validSpineRefs = append(validSpineRefs, ref)
	}

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

		var content []byte
		var errRead error
		if dummyContent, ok := editedFiles[item.FullPath]; ok {
			content = dummyContent
		} else {
			f := ctx.Entries[item.FullPath]
			if f == nil {
				continue
			}
			content, errRead = readZipFile(f)
			if errRead != nil {
				continue
			}
		}

		htmlStr := string(content)
		xmlFixCount := 0

		fixedHTML := reTags.ReplaceAllStringFunc(htmlStr, func(m string) string {
			trimmed := strings.TrimSpace(m)
			if strings.HasSuffix(trimmed, "/>") {
				return m
			}
			tagBody := m[1 : len(m)-1]
			tagBody = strings.TrimSuffix(tagBody, "/")
			tagBody = strings.TrimSpace(tagBody)
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

		cleanedHTML, cleanLogs := cleanHTMLTOC(ctx, item.FullPath, fixedHTML)
		hasTOCChanges := len(cleanLogs) > 0

		if xmlFixCount > 0 || hasTOCChanges {
			if hasTOCChanges {
				fixedHTML = cleanedHTML
				logs = append(logs, cleanLogs...)
			}
			editedFiles[item.FullPath] = []byte(fixedHTML)
			if xmlFixCount > 0 {
				logs = append(logs, fmt.Sprintf("[XHTML] Đã sửa %d lỗi cú pháp XML (thẻ tự đóng, namespace) trong %s", xmlFixCount, item.Href))
			}
		}
	}

	var ncxContent string
	var ncxPath string
	if ctx.NCX != nil {
		ncxPath = ctx.NCX.FullPath
		if data, err := ctx.readText(ncxPath); err == nil {
			ncxContent = data
		}
	}

	if ncxContent != "" {
		var updatedTOC []TocPoint
		tocFixedCount := 0
		playOrderFixed := false

		for _, point := range ctx.TOC {
			resolved := resolveZipHref(ctx.OPFDir, point.Src)
			if resolved == "" {
				tocFixedCount++
				logs = append(logs, fmt.Sprintf("[Mục lục] Đã xóa mục liên kết rỗng hoặc không hợp lệ: %s", point.Title))
				continue
			}
			targetItem, ok := ctx.ManifestByPath[resolved]
			if !ok || removedManifestIDs[targetItem.ID] {
				tocFixedCount++
				logs = append(logs, fmt.Sprintf("[Mục lục] Đã loại bỏ liên kết hỏng tới tệp không tồn tại: %s -> %s", point.Title, point.Src))
				continue
			}

			title := point.Title
			if title == "" || strings.HasPrefix(strings.ToLower(title), "chapter") || strings.HasSuffix(strings.ToLower(title), ".xhtml") || strings.HasSuffix(strings.ToLower(title), ".html") {
				htmlTitle := ctx.htmlTitle(resolved)
				if htmlTitle != "" && htmlTitle != title {
					tocFixedCount++
					logs = append(logs, fmt.Sprintf("[Mục lục] Đã cập nhật tiêu đề chương: '%s' -> '%s'", title, htmlTitle))
					title = htmlTitle
				}
			}

			updatedTOC = append(updatedTOC, TocPoint{
				Title:    title,
				Src:      point.Src,
				FullPath: resolved,
			})
		}

		var deduplicatedTOC []TocPoint
		for i, pt := range updatedTOC {
			if i > 0 && deduplicatedTOC[len(deduplicatedTOC)-1].Src == pt.Src && deduplicatedTOC[len(deduplicatedTOC)-1].Title == pt.Title {
				tocFixedCount++
				logs = append(logs, fmt.Sprintf("[Mục lục] Loại bỏ liên kết trùng lặp: %s", pt.Title))
				continue
			}
			deduplicatedTOC = append(deduplicatedTOC, pt)
		}

		if tocFixedCount > 0 {
			ncxContent = ctx.rebuildNCXFromTOC(ncxPath, deduplicatedTOC, ctx.Title)
			editedFiles[ncxPath] = []byte(ncxContent)
		}

		renumberedNCX := renumberPlayOrder(ncxContent)
		if renumberedNCX != ncxContent {
			editedFiles[ncxPath] = []byte(renumberedNCX)
			ncxContent = renumberedNCX
			playOrderFixed = true
		}
		if playOrderFixed {
			logs = append(logs, "[Mục lục] Đã chuẩn hóa thuộc tính thứ tự phát (playOrder) trong NCX.")
		}
	} else {
		ncxPath = resolveZipHref(ctx.OPFDir, "toc.ncx")
		logs = append(logs, "[Mục lục] Thiếu file NCX mục lục, tiến hành tự động tạo mới dựa trên cấu trúc chương.")
		
		var tocPoints []TocPoint
		for _, ref := range validSpineRefs {
			item, ok := ctx.ManifestByID[ref.IDRef]
			if !ok {
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
		
		ncxContent = ctx.rebuildNCXFromTOC(ncxPath, tocPoints, ctx.Title)
		editedFiles[ncxPath] = []byte(ncxContent)
	}

	opfContent := ctx.OPFXML
	
	hasNCXDecl := false
	for _, item := range ctx.Manifest {
		if item.ID == "ncx" || item.MediaType == "application/x-dtbncx+xml" || strings.HasSuffix(strings.ToLower(item.FullPath), ".ncx") {
			hasNCXDecl = true
			break
		}
	}
	if !hasNCXDecl {
		ncxRelHref := relativeZipPath(ctx.OPFPath, ncxPath)
		newItemTag := fmt.Sprintf(`    <item id="ncx" href="%s" media-type="application/x-dtbncx+xml" />`, ncxRelHref)
		manifestMatch := manifestRe.FindStringSubmatch(opfContent)
		if len(manifestMatch) >= 4 {
			opfContent = replaceXMLBlock(manifestRe, opfContent, manifestMatch[2]+"\n"+newItemTag)
		}
		spineStartMatch := regexp.MustCompile(`(?i)<spine\b[^>]*>`).FindString(opfContent)
		if spineStartMatch != "" {
			attrs := parseAttrs(spineStartMatch)
			if attrs["toc"] == "" {
				newSpineStart := `<spine toc="ncx">`
				opfContent = strings.Replace(opfContent, spineStartMatch, newSpineStart, 1)
			}
		}
	}

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
		sb.WriteString("/>")
		updatedManifestItems = append(updatedManifestItems, "    "+sb.String())
	}
	for _, item := range addedManifestItems {
		newItemTag := fmt.Sprintf(`    <item id="%s" href="%s" media-type="%s" />`, escapeXML(item.ID), escapeXML(item.Href), escapeXML(item.MediaType))
		updatedManifestItems = append(updatedManifestItems, newItemTag)
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
		sb.WriteString("/>")
		updatedSpineRefs = append(updatedSpineRefs, "    "+sb.String())
	}
	opfContent = replaceXMLBlock(spineRe, opfContent, strings.Join(updatedSpineRefs, "\n"))
	
	editedFiles[ctx.OPFPath] = []byte(opfContent)

	tmp := ctx.FilePath + ".tmp"
	out, err := os.Create(tmp)
	if err != nil {
		return models.RepairResponse{}, err
	}
	zw := zip.NewWriter(out)

	header := &zip.FileHeader{Name: "mimetype", Method: zip.Store}
	header.SetMode(0644)
	w, err := zw.CreateHeader(header)
	if err != nil {
		return closeRepairZipErr(zw, out, tmp, err)
	}
	if _, err := w.Write([]byte("application/epub+zip")); err != nil {
		return closeRepairZipErr(zw, out, tmp, err)
	}
	logs = append(logs, "[Mimetype] Đã cấu hình và lưu trữ file mimetype ở chế độ không nén (Store).")

	for _, f := range ctx.Reader.File {
		if f.FileInfo().IsDir() || f.Name == "mimetype" {
			continue
		}

		var data []byte
		var writeMethod uint16 = zip.Deflate

		if content, ok := editedFiles[f.Name]; ok {
			data = content
		} else {
			data, err = readZipFile(f)
			if err != nil {
				return closeRepairZipErr(zw, out, tmp, err)
			}
			writeMethod = f.Method
		}

		header := &zip.FileHeader{Name: f.Name, Method: writeMethod}
		header.SetMode(f.Mode())
		writer, err := zw.CreateHeader(header)
		if err != nil {
			return closeRepairZipErr(zw, out, tmp, err)
		}
		if _, err := writer.Write(data); err != nil {
			return closeRepairZipErr(zw, out, tmp, err)
		}
	}

	for path, content := range editedFiles {
		found := false
		for _, f := range ctx.Reader.File {
			if f.Name == path {
				found = true
				break
			}
		}
		if !found {
			header := &zip.FileHeader{Name: path, Method: zip.Deflate}
			header.SetMode(0644)
			writer, err := zw.CreateHeader(header)
			if err != nil {
				return closeRepairZipErr(zw, out, tmp, err)
			}
			if _, err := writer.Write(content); err != nil {
				return closeRepairZipErr(zw, out, tmp, err)
			}
		}
	}

	if err := zw.Close(); err != nil {
		_ = out.Close()
		_ = os.Remove(tmp)
		return models.RepairResponse{}, err
	}
	if err := out.Close(); err != nil {
		_ = os.Remove(tmp)
		return models.RepairResponse{}, err
	}

	ctx.Close()
	if err := os.Remove(ctx.FilePath); err != nil {
		_ = os.Remove(tmp)
		return models.RepairResponse{}, err
	}
	if err := os.Rename(tmp, ctx.FilePath); err != nil {
		_ = os.Remove(tmp)
		return models.RepairResponse{}, err
	}

	newCtx, err := loadBook(id)
	if err != nil {
		return models.RepairResponse{}, err
	}
	defer newCtx.Close()

	if len(logs) == 0 {
		logs = append(logs, "Không phát hiện lỗi cấu trúc nào cần sửa chữa.")
	}

	return models.RepairResponse{
		Success:  true,
		Logs:     logs,
		Analysis: newCtx.Analysis(),
	}, nil
}

func closeRepairZipErr(zw *zip.Writer, out *os.File, tmp string, err error) (models.RepairResponse, error) {
	_ = zw.Close()
	_ = out.Close()
	_ = os.Remove(tmp)
	return models.RepairResponse{}, err
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

	reSection := regexp.MustCompile(`(?is)<section\b[^>]*>(.*?)</section>`)
	reLi := regexp.MustCompile(`(?is)<li\b[^>]*>(.*?)</li>`)
	reA := regexp.MustCompile(`(?is)<a\b[^>]*\bhref\s*=\s*["']([^"']*)["'][^>]*>(.*?)</a>`)

	cleanedHTML := reSection.ReplaceAllStringFunc(htmlContent, func(section string) string {
		liMatches := reLi.FindAllString(section, -1)
		if len(liMatches) == 0 {
			return section
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
			if m := reVolTitle.FindString(section); m != "" {
				volTitle = strings.TrimSpace(m)
			}
			if volTitle == "" {
				volTitle = "Phần nội dung trống"
			}
			logs = append(logs, fmt.Sprintf("[Nội dung] Đã ẩn phần danh mục không tồn tại: %s", volTitle))
			return ""
		}

		liCounter := 0
		newSection := reLi.ReplaceAllStringFunc(section, func(oldLi string) string {
			keep := liKeep[liCounter]
			liCounter++
			if keep {
				return oldLi
			}
			return ""
		})

		return newSection
	})

	return cleanedHTML, logs
}
