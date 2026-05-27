package service

import (
	"archive/zip"
	"bytes"
	"encoding/base64"
	"epubforge/internal/models"
	"errors"
	"fmt"
	"image"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

type createSpineItem struct {
	ID    string
	Href  string
	Title string
}

type createManifestItem struct {
	ID        string
	Href      string
	MediaType string
}

func (s *Service) CreateEpub(req models.CreateEpubRequest, mangaImages map[string][]models.UploadedMangaImage) (string, error) {
	title := strings.TrimSpace(req.Title)
	if strings.TrimSpace(req.Metadata.Title) != "" {
		title = strings.TrimSpace(req.Metadata.Title)
	}
	if title == "" {
		return "", errors.New("tiêu đề sách là bắt buộc")
	}

	if len(req.Chapters) == 0 {
		return "", errors.New("vui lòng tạo ít nhất một chương")
	}

	author := strings.TrimSpace(req.Author)
	if strings.TrimSpace(req.Metadata.Creator) != "" {
		author = strings.TrimSpace(req.Metadata.Creator)
	}
	if author == "" {
		author = "Khuyết danh"
	}
	metadata := req.Metadata
	metadata.Title = title
	metadata.Creator = author
	if strings.TrimSpace(metadata.Language) == "" {
		metadata.Language = "vi"
	}

	direction := strings.ToLower(strings.TrimSpace(req.Direction))
	if direction != "rtl" {
		direction = "ltr"
	}

	outputName, outputPath := uniqueCreateOutputPath(title)
	out, err := os.Create(outputPath)
	if err != nil {
		return "", fmt.Errorf("không thể tạo file EPUB mới: %w", err)
	}
	defer out.Close()

	zw := zip.NewWriter(out)
	defer zw.Close()

	if err := writeStoredMimetype(zw); err != nil {
		return "", err
	}
	if err := writeZipText(zw, "META-INF/container.xml", createContainerXML); err != nil {
		return "", err
	}
	if err := writeZipText(zw, "OEBPS/Styles/style.css", createDefaultCSS); err != nil {
		return "", err
	}

	coverItem := createManifestItem{}
	if strings.HasPrefix(metadata.CoverImage, "data:image/") {
		coverBytes, mimeType, err := parseBase64Image(metadata.CoverImage)
		if err != nil {
			return "", fmt.Errorf("ảnh bìa không hợp lệ: %w", err)
		}
		ext := ".jpg"
		switch mimeType {
		case "image/png":
			ext = ".png"
		case "image/gif":
			ext = ".gif"
		case "image/webp":
			ext = ".webp"
		}
		coverHref := "Images/cover" + ext
		if err := writeZipBytes(zw, "OEBPS/"+coverHref, coverBytes); err != nil {
			return "", fmt.Errorf("không thể ghi ảnh bìa: %w", err)
		}
		coverItem = createManifestItem{ID: "cover-image", Href: coverHref, MediaType: mimeType}
	}

	manifest := []createManifestItem{
		{ID: "nav", Href: "Text/nav.xhtml", MediaType: "application/xhtml+xml"},
		{ID: "ncx", Href: "toc.ncx", MediaType: "application/x-dtbncx+xml"},
		{ID: "style", Href: "Styles/style.css", MediaType: "text/css"},
	}

	for assetPath, base64Data := range req.Assets {
		cleanPath, ok := cleanEPUBAssetPath(assetPath)
		if !ok {
			continue
		}

		var dataBytes []byte
		var err error
		if idx := strings.Index(base64Data, ";base64,"); idx != -1 {
			dataBytes, err = base64.StdEncoding.DecodeString(base64Data[idx+8:])
		} else {
			dataBytes, err = base64.StdEncoding.DecodeString(base64Data)
		}
		if err != nil {
			continue
		}

		if err := writeZipBytes(zw, "OEBPS/"+cleanPath, dataBytes); err != nil {
			return "", err
		}

		mime := contentTypeFor(cleanPath)
		cleanID := sanitizeManifestID("asset_" + cleanPath)
		manifest = append(manifest, createManifestItem{
			ID:        cleanID,
			Href:      cleanPath,
			MediaType: mime,
		})
	}

	if coverItem.ID != "" {
		manifest = append(manifest, coverItem)
	}
	var spine []createSpineItem
	var toc []createSpineItem
	fixedLayout := false

	if coverItem.ID != "" {
		coverPageHref := "Text/titlepage.xhtml"
		coverPageID := "titlepage"
		coverPageHTML := fmt.Sprintf(`<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
  <title>Cover</title>
  <style type="text/css">
    body { margin: 0; padding: 0; text-align: center; background-color: #ffffff; }
    div.cover { margin: 0; padding: 0; text-align: center; }
    img.cover { max-width: 100%%; max-height: 100%%; height: auto; }
  </style>
</head>
<body>
  <div class="cover">
    <img class="cover" src="../%s" alt="Cover" />
  </div>
</body>
</html>`, coverItem.Href)

		if err := writeZipText(zw, "OEBPS/"+coverPageHref, coverPageHTML); err != nil {
			return "", fmt.Errorf("không thể ghi trang bìa: %w", err)
		}

		manifest = append(manifest, createManifestItem{ID: coverPageID, Href: coverPageHref, MediaType: "application/xhtml+xml"})
		spine = append(spine, createSpineItem{ID: coverPageID, Href: coverPageHref, Title: "Cover"})
		toc = append(toc, createSpineItem{ID: coverPageID, Href: coverPageHref, Title: "Cover"})
	}

	tocPageHref := "Text/index.html"
	tocPageID := "index_html"
	spine = append(spine, createSpineItem{ID: tocPageID, Href: tocPageHref, Title: title})
	toc = append(toc, createSpineItem{ID: tocPageID, Href: tocPageHref, Title: title})

	var chapterSpineItems []createSpineItem
	var actualChaptersToc []createSpineItem

	for idx, chapter := range req.Chapters {
		chapterTitle := strings.TrimSpace(chapter.Title)
		if chapterTitle == "" {
			chapterTitle = fmt.Sprintf("Chương %d", idx+1)
		}

		mode := strings.ToLower(strings.TrimSpace(chapter.Mode))
		if mode == "manga" {
			fixedLayout = true
			pages, items, err := writeMangaChapter(zw, idx, chapterTitle, mangaImages[chapter.ID])
			if err != nil {
				return "", err
			}
			if len(pages) == 0 {
				return "", fmt.Errorf("chương %q chưa có ảnh manga", chapterTitle)
			}
			manifest = append(manifest, items...)
			chapterSpineItems = append(chapterSpineItems, pages...)
			actualChaptersToc = append(actualChaptersToc, createSpineItem{ID: pages[0].ID, Href: pages[0].Href, Title: chapterTitle})
			if strings.ToLower(chapter.MangaDirection) == "rtl" {
				direction = "rtl"
			}
			continue
		}

		href := fmt.Sprintf("Text/chapter_%03d.xhtml", idx+1)
		id := fmt.Sprintf("chapter_%03d", idx+1)
		html := createNormalChapterHTML(chapterTitle, chapter.Text, chapter.RawHTML, req.Assets)
		if err := writeZipText(zw, "OEBPS/"+href, html); err != nil {
			return "", err
		}
		manifest = append(manifest, createManifestItem{ID: id, Href: href, MediaType: "application/xhtml+xml"})
		item := createSpineItem{ID: id, Href: href, Title: chapterTitle}
		chapterSpineItems = append(chapterSpineItems, item)
		actualChaptersToc = append(actualChaptersToc, item)
	}

	spine = append(spine, chapterSpineItems...)
	toc = append(toc, actualChaptersToc...)

	var tocListBuilder strings.Builder
	currentDateStr := time.Now().Format("02/01/2006")
	for _, item := range actualChaptersToc {
		relHref := relativeManifestHref(tocPageHref, item.Href)
		tocListBuilder.WriteString(fmt.Sprintf(`    <li>
      <a href="%s">%s</a>
      <div class="date">%s</div>
    </li>`+"\n", escapeXML(relHref), escapeXML(item.Title), currentDateStr))
	}

	visibleTOCPageHTML := fmt.Sprintf(`<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
  <title>%s</title>
  <link rel="stylesheet" type="text/css" href="../Styles/style.css" />
  <style type="text/css">
    body {
      font-family: sans-serif;
      margin: 5%%;
    }
    h1 {
      text-align: center;
      margin-bottom: 1.5em;
    }
    ul {
      list-style-type: none;
      padding-left: 0;
    }
    li {
      margin-bottom: 15px;
      border-bottom: 1px solid #eee;
      padding-bottom: 10px;
    }
    a {
      text-decoration: none;
      color: #0066cc;
      font-weight: bold;
      font-size: 1.1em;
    }
    a:hover {
      color: #003399;
      text-decoration: underline;
    }
    .date {
      font-size: 0.85em;
      color: #888;
      margin-top: 4px;
    }
  </style>
</head>
<body>
  <h1>%s</h1>
  <ul>
%s  </ul>
</body>
</html>`, escapeXML(title), escapeXML(title), tocListBuilder.String())

	if err := writeZipText(zw, "OEBPS/"+tocPageHref, visibleTOCPageHTML); err != nil {
		return "", fmt.Errorf("không thể ghi trang mục lục: %w", err)
	}

	manifest = append(manifest, createManifestItem{ID: tocPageID, Href: tocPageHref, MediaType: "application/xhtml+xml"})

	if len(spine) == 0 {
		return "", errors.New("không có nội dung hợp lệ để tạo EPUB")
	}

	uuidID := "uuid-" + randomID()
	if err := writeZipText(zw, "OEBPS/content.opf", createOPFXML(metadata, uuidID, direction, manifest, spine, coverItem.ID != "", fixedLayout)); err != nil {
		return "", err
	}
	if err := writeZipText(zw, "OEBPS/toc.ncx", createNCXXML(title, uuidID, toc)); err != nil {
		return "", err
	}
	if err := writeZipText(zw, "OEBPS/Text/nav.xhtml", createNavXMLAt("Text/nav.xhtml", toc)); err != nil {
		return "", err
	}

	if err := zw.Close(); err != nil {
		return "", fmt.Errorf("lỗi đóng file zip: %w", err)
	}
	if err := out.Close(); err != nil {
		return "", fmt.Errorf("lỗi đóng file: %w", err)
	}

	if err := s.repairCreatedEpub(outputName); err != nil {
		_ = removeFileWithRetry(outputPath)
		return "", fmt.Errorf("không thể tự sửa EPUB sau khi tạo: %w", err)
	}

	return outputName, nil
}

func (s *Service) repairCreatedEpub(outputName string) error {
	id := toID(outputName)
	_, err := s.Repair(id, []string{"FIX_XHTML", "CLEAN_BROKEN_CONTENT_LINKS"})
	return err
}

func uniqueCreateOutputPath(title string) (string, string) {
	cleanTitle := sanitizeFileName(title)
	if cleanTitle == "" {
		cleanTitle = "epub"
	}

	outputName := cleanTitle + ".epub"
	outputPath := filepath.Join(editDir, outputName)
	counter := 1
	for {
		if _, err := os.Stat(outputPath); os.IsNotExist(err) {
			return outputName, outputPath
		}
		outputName = fmt.Sprintf("%s (%d).epub", cleanTitle, counter)
		outputPath = filepath.Join(editDir, outputName)
		counter++
	}
}

func writeStoredMimetype(zw *zip.Writer) error {
	header := &zip.FileHeader{Name: "mimetype", Method: zip.Store}
	header.SetMode(0644)
	w, err := zw.CreateHeader(header)
	if err != nil {
		return err
	}
	_, err = w.Write([]byte("application/epub+zip"))
	return err
}

func writeZipText(zw *zip.Writer, name, content string) error {
	w, err := zw.CreateHeader(&zip.FileHeader{Name: name, Method: zip.Deflate})
	if err != nil {
		return err
	}
	_, err = w.Write([]byte(content))
	return err
}

func writeZipBytes(zw *zip.Writer, name string, data []byte) error {
	w, err := zw.CreateHeader(&zip.FileHeader{Name: name, Method: zip.Deflate})
	if err != nil {
		return err
	}
	_, err = w.Write(data)
	return err
}

func cleanEPUBAssetPath(input string) (string, bool) {
	clean := strings.TrimSpace(strings.ReplaceAll(input, "\\", "/"))
	clean = strings.TrimPrefix(clean, "/")
	clean = path.Clean(clean)
	if clean == "." || clean == "" || strings.HasPrefix(clean, "../") || clean == ".." {
		return "", false
	}
	return clean, true
}

func sanitizeManifestID(input string) string {
	replacer := strings.NewReplacer("/", "_", ".", "_", "-", "_", " ", "_")
	clean := replacer.Replace(input)
	clean = regexp.MustCompile(`[^A-Za-z0-9_:.]`).ReplaceAllString(clean, "_")
	clean = strings.Trim(clean, "_")
	if clean == "" {
		clean = "item"
	}
	if first := clean[0]; (first < 'A' || first > 'Z') && (first < 'a' || first > 'z') && first != '_' {
		clean = "item_" + clean
	}
	return clean
}

func relativeManifestHref(fromHref, toHref string) string {
	fromPath := path.Clean(strings.TrimPrefix(strings.ReplaceAll(fromHref, "\\", "/"), "/"))
	toPath := path.Clean(strings.TrimPrefix(strings.ReplaceAll(toHref, "\\", "/"), "/"))
	if fromPath == "." || toPath == "." {
		return toHref
	}
	return relativeZipPath(fromPath, toPath)
}

func createNormalChapterHTML(title, content string, rawHTML bool, assets map[string]string) string {
	if rawHTML {
		trimmed := rewriteRawChapterAssetRefs(strings.TrimSpace(content), assets)
		if strings.Contains(strings.ToLower(trimmed), "<html") {
			if isChapterTitleMissing(trimmed) {
				reBody := regexp.MustCompile(`(?i)(<body[^>]*>)`)
				bodyMatch := reBody.FindStringSubmatchIndex(trimmed)
				if len(bodyMatch) >= 2 {
					bodyTagEnd := bodyMatch[1]
					heading := fmt.Sprintf("\n  <h2>%s</h2>", escapeXML(title))
					trimmed = trimmed[:bodyTagEnd] + heading + trimmed[bodyTagEnd:]
				}
			}
			return trimmed
		}

		dummyHTML := "<body>" + trimmed + "</body>"
		if isChapterTitleMissing(dummyHTML) {
			return wrapChapterBody(title, fmt.Sprintf("  <h2>%s</h2>\n%s", escapeXML(title), trimmed))
		}
		return wrapChapterBody(title, trimmed)
	}

	var body strings.Builder
	lines := strings.Split(strings.ReplaceAll(content, "\r\n", "\n"), "\n")
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line != "" {
			body.WriteString("  <p>")
			body.WriteString(escapeXML(line))
			body.WriteString("</p>\n")
		}
	}
	return wrapChapterBody(title, fmt.Sprintf("  <h2>%s</h2>\n%s", escapeXML(title), body.String()))
}

var rawChapterAssetAttrRe = regexp.MustCompile(`(?is)\s(src|href|xlink:href)\s*=\s*("[^"]*"|'[^']*')`)

func rewriteRawChapterAssetRefs(content string, assets map[string]string) string {
	if len(assets) == 0 || content == "" {
		return content
	}

	assetPaths := make(map[string]struct{}, len(assets))
	for assetPath := range assets {
		cleanPath := strings.TrimPrefix(strings.ReplaceAll(assetPath, "\\", "/"), "/")
		if cleanPath != "" {
			assetPaths[path.Clean(cleanPath)] = struct{}{}
		}
	}

	return rawChapterAssetAttrRe.ReplaceAllStringFunc(content, func(full string) string {
		m := rawChapterAssetAttrRe.FindStringSubmatch(full)
		if len(m) != 3 || len(m[2]) < 2 {
			return full
		}

		quote := m[2][:1]
		ref := m[2][1 : len(m[2])-1]
		if isExternalRef(ref) || strings.HasPrefix(ref, "#") {
			return full
		}

		refPath, suffix := splitRefSuffix(strings.ReplaceAll(ref, "\\", "/"))
		if refPath == "" {
			return full
		}

		if target, ok := matchRawChapterAsset(refPath, assetPaths); ok {
			rel, err := filepath.Rel(filepath.FromSlash("Text"), filepath.FromSlash(target))
			rel = filepath.ToSlash(rel)
			if err == nil && rel != "." && !strings.HasPrefix(rel, "../..") {
				return fmt.Sprintf(` %s=%s%s%s%s`, m[1], quote, rel, suffix, quote)
			}
		}

		return full
	})
}

func splitRefSuffix(ref string) (string, string) {
	idx := len(ref)
	if q := strings.Index(ref, "?"); q >= 0 && q < idx {
		idx = q
	}
	if h := strings.Index(ref, "#"); h >= 0 && h < idx {
		idx = h
	}
	return ref[:idx], ref[idx:]
}

func matchRawChapterAsset(refPath string, assetPaths map[string]struct{}) (string, bool) {
	cleanRef := strings.TrimPrefix(refPath, "/")
	candidates := []string{
		path.Clean(cleanRef),
		path.Clean(path.Join("Text", cleanRef)),
	}

	for _, candidate := range candidates {
		if _, ok := assetPaths[candidate]; ok {
			return candidate, true
		}
	}
	return "", false
}

func wrapChapterBody(title, body string) string {
	return fmt.Sprintf(`<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
  <title>%s</title>
  <link rel="stylesheet" type="text/css" href="../Styles/style.css" />
</head>
<body>
%s
</body>
</html>`, escapeXML(title), body)
}

func writeMangaChapter(zw *zip.Writer, chapterIndex int, title string, images []models.UploadedMangaImage) ([]createSpineItem, []createManifestItem, error) {
	var spine []createSpineItem
	var manifest []createManifestItem

	for pageIndex, img := range images {
		pageNum := pageIndex + 1
		ext := strings.ToLower(filepath.Ext(img.Filename))
		if ext == "" {
			ext = ".jpg"
		}
		imageName := fmt.Sprintf("chapter_%03d_page_%03d%s", chapterIndex+1, pageNum, ext)
		imageHref := "Images/" + imageName
		if err := writeZipBytes(zw, "OEBPS/"+imageHref, img.Data); err != nil {
			return nil, nil, fmt.Errorf("lỗi khi ghi ảnh %s: %w", img.Filename, err)
		}

		width, height := 800, 1200
		if cfg, _, err := image.DecodeConfig(bytes.NewReader(img.Data)); err == nil && cfg.Width > 0 && cfg.Height > 0 {
			width = cfg.Width
			height = cfg.Height
		}

		pageID := fmt.Sprintf("chapter_%03d_page_%03d", chapterIndex+1, pageNum)
		pageTitle := fmt.Sprintf("%s - Trang %d", title, pageNum)
		pageHref := fmt.Sprintf("Text/%s.xhtml", pageID)
		pageHTML := fmt.Sprintf(`<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
  <title>%s</title>
  <meta name="viewport" content="width=%d, height=%d" />
  <style type="text/css">
    body { margin: 0; padding: 0; background: #000; }
    img { width: 100%%; height: 100%%; display: block; object-fit: contain; }
  </style>
</head>
<body>
  <img src="../%s" alt="%s" />
</body>
</html>`, escapeXML(pageTitle), width, height, imageHref, escapeXML(pageTitle))
		if err := writeZipText(zw, "OEBPS/"+pageHref, pageHTML); err != nil {
			return nil, nil, err
		}

		imageID := fmt.Sprintf("img_%03d_%03d", chapterIndex+1, pageNum)
		manifest = append(manifest,
			createManifestItem{ID: pageID, Href: pageHref, MediaType: "application/xhtml+xml"},
			createManifestItem{ID: imageID, Href: imageHref, MediaType: imageMediaType(ext)},
		)
		spine = append(spine, createSpineItem{ID: pageID, Href: pageHref, Title: pageTitle})
	}

	return spine, manifest, nil
}

func imageMediaType(ext string) string {
	switch strings.ToLower(ext) {
	case ".png":
		return "image/png"
	case ".gif":
		return "image/gif"
	case ".webp":
		return "image/webp"
	default:
		return "image/jpeg"
	}
}

func createOPFXML(metadata models.BookMetadata, uuidID, direction string, manifest []createManifestItem, spine []createSpineItem, hasCover bool, fixedLayout bool) string {
	var manifestBuilder strings.Builder
	for _, item := range manifest {
		props := ""
		if item.ID == "nav" {
			props = ` properties="nav"`
		} else if item.ID == "cover-image" {
			props = ` properties="cover-image"`
		}
		manifestBuilder.WriteString(fmt.Sprintf(`    <item id="%s" href="%s" media-type="%s"%s />`+"\n",
			escapeXML(item.ID), escapeXML(item.Href), escapeXML(item.MediaType), props))
	}

	var spineBuilder strings.Builder
	for _, item := range spine {
		spineBuilder.WriteString(fmt.Sprintf(`    <itemref idref="%s" />`+"\n", escapeXML(item.ID)))
	}

	var extraMetadata strings.Builder
	if strings.TrimSpace(metadata.Publisher) != "" {
		extraMetadata.WriteString(fmt.Sprintf("    <dc:publisher>%s</dc:publisher>\n", escapeXML(metadata.Publisher)))
	}
	if strings.TrimSpace(metadata.Description) != "" {
		extraMetadata.WriteString(fmt.Sprintf("    <dc:description>%s</dc:description>\n", escapeXML(metadata.Description)))
	}
	if strings.TrimSpace(metadata.Subject) != "" {
		for _, subject := range strings.Split(metadata.Subject, ",") {
			subject = strings.TrimSpace(subject)
			if subject != "" {
				extraMetadata.WriteString(fmt.Sprintf("    <dc:subject>%s</dc:subject>\n", escapeXML(subject)))
			}
		}
	}
	if strings.TrimSpace(metadata.Series) != "" {
		extraMetadata.WriteString(fmt.Sprintf("    <meta property=\"belongs-to-collection\">%s</meta>\n", escapeXML(metadata.Series)))
		extraMetadata.WriteString(fmt.Sprintf("    <meta name=\"calibre:series\" content=\"%s\" />\n", escapeXML(metadata.Series)))
	}
	if strings.TrimSpace(metadata.SeriesIndex) != "" {
		extraMetadata.WriteString(fmt.Sprintf("    <meta property=\"group-position\">%s</meta>\n", escapeXML(metadata.SeriesIndex)))
		extraMetadata.WriteString(fmt.Sprintf("    <meta name=\"calibre:series_index\" content=\"%s\" />\n", escapeXML(metadata.SeriesIndex)))
	}
	if hasCover {
		extraMetadata.WriteString("    <meta name=\"cover\" content=\"cover-image\" />\n")
	}
	if fixedLayout {
		extraMetadata.WriteString("    <meta property=\"rendition:layout\">pre-paginated</meta>\n")
		extraMetadata.WriteString("    <meta property=\"rendition:orientation\">auto</meta>\n")
		extraMetadata.WriteString("    <meta property=\"rendition:spread\">auto</meta>\n")
	}

	return fmt.Sprintf(`<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="pub-id" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>%s</dc:title>
    <dc:creator id="creator">%s</dc:creator>
    <dc:language>%s</dc:language>
    <dc:identifier id="pub-id">%s</dc:identifier>
%s
    <meta property="dcterms:modified">%s</meta>
  </metadata>
  <manifest>
%s  </manifest>
  <spine toc="ncx" page-progression-direction="%s">
%s  </spine>
</package>`, escapeXML(metadata.Title), escapeXML(metadata.Creator), escapeXML(metadata.Language), uuidID, extraMetadata.String(), time.Now().UTC().Format("2006-01-02T15:04:05Z"), manifestBuilder.String(), direction, spineBuilder.String())
}

func createNCXXML(title, uuidID string, items []createSpineItem) string {
	var points strings.Builder
	for idx, item := range items {
		points.WriteString(fmt.Sprintf(`    <navPoint id="nav-%d" playOrder="%d">
      <navLabel><text>%s</text></navLabel>
      <content src="%s" />
    </navPoint>`+"\n", idx+1, idx+1, escapeXML(item.Title), item.Href))
	}
	return fmt.Sprintf(`<?xml version="1.0" encoding="utf-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="%s" />
    <meta name="dtb:depth" content="1" />
    <meta name="dtb:totalPageCount" content="0" />
    <meta name="dtb:maxPageNumber" content="0" />
  </head>
  <docTitle><text>%s</text></docTitle>
  <navMap>
%s  </navMap>
</ncx>`, uuidID, escapeXML(title), points.String())
}

func createNavXMLAt(navHref string, items []createSpineItem) string {
	var links strings.Builder
	for _, item := range items {
		relHref := relativeManifestHref(navHref, item.Href)
		links.WriteString(fmt.Sprintf(`      <li><a href="%s">%s</a></li>`+"\n", escapeXML(relHref), escapeXML(item.Title)))
	}
	return fmt.Sprintf(`<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head>
  <title>Mục lục</title>
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

const createContainerXML = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`

const createDefaultCSS = `body {
  font-family: sans-serif;
  margin: 5%;
  line-height: 1.6;
}
h2 {
  text-align: center;
  margin: 3em 0 2em;
}
p {
  margin: 0.5em 0;
  text-align: justify;
  text-indent: 1.5em;
}`
