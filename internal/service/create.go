package service

import (
	"archive/zip"
	"bytes"
	"epubforge/internal/models"
	"errors"
	"fmt"
	"image"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"os"
	"path/filepath"
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
	if coverItem.ID != "" {
		manifest = append(manifest, coverItem)
	}
	var spine []createSpineItem
	var toc []createSpineItem

	for idx, chapter := range req.Chapters {
		chapterTitle := strings.TrimSpace(chapter.Title)
		if chapterTitle == "" {
			chapterTitle = fmt.Sprintf("Chương %d", idx+1)
		}

		mode := strings.ToLower(strings.TrimSpace(chapter.Mode))
		if mode == "manga" {
			pages, items, err := writeMangaChapter(zw, idx, chapterTitle, mangaImages[chapter.ID])
			if err != nil {
				return "", err
			}
			if len(pages) == 0 {
				return "", fmt.Errorf("chương %q chưa có ảnh manga", chapterTitle)
			}
			manifest = append(manifest, items...)
			spine = append(spine, pages...)
			toc = append(toc, createSpineItem{ID: pages[0].ID, Href: pages[0].Href, Title: chapterTitle})
			if strings.ToLower(chapter.MangaDirection) == "rtl" {
				direction = "rtl"
			}
			continue
		}

		href := fmt.Sprintf("Text/chapter_%03d.xhtml", idx+1)
		id := fmt.Sprintf("chapter_%03d", idx+1)
		html := createNormalChapterHTML(chapterTitle, chapter.Text, chapter.RawHTML)
		if err := writeZipText(zw, "OEBPS/"+href, html); err != nil {
			return "", err
		}
		manifest = append(manifest, createManifestItem{ID: id, Href: href, MediaType: "application/xhtml+xml"})
		item := createSpineItem{ID: id, Href: href, Title: chapterTitle}
		spine = append(spine, item)
		toc = append(toc, item)
	}

	if len(spine) == 0 {
		return "", errors.New("không có nội dung hợp lệ để tạo EPUB")
	}

	uuidID := "uuid-" + randomID()
	if err := writeZipText(zw, "OEBPS/content.opf", createOPFXML(metadata, uuidID, direction, manifest, spine, coverItem.ID != "")); err != nil {
		return "", err
	}
	if err := writeZipText(zw, "OEBPS/toc.ncx", createNCXXML(title, uuidID, toc)); err != nil {
		return "", err
	}
	if err := writeZipText(zw, "OEBPS/Text/nav.xhtml", createNavXML(toc)); err != nil {
		return "", err
	}

	if err := zw.Close(); err != nil {
		return "", fmt.Errorf("lỗi đóng file zip: %w", err)
	}

	return outputName, nil
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

func createNormalChapterHTML(title, content string, rawHTML bool) string {
	if rawHTML {
		trimmed := strings.TrimSpace(content)
		if strings.Contains(strings.ToLower(trimmed), "<html") {
			return trimmed
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

func createOPFXML(metadata models.BookMetadata, uuidID, direction string, manifest []createManifestItem, spine []createSpineItem, hasCover bool) string {
	var manifestBuilder strings.Builder
	for _, item := range manifest {
		props := ""
		if item.ID == "nav" {
			props = ` properties="nav"`
		} else if item.ID == "cover-image" {
			props = ` properties="cover-image"`
		}
		manifestBuilder.WriteString(fmt.Sprintf(`    <item id="%s" href="%s" media-type="%s"%s />`+"\n", item.ID, item.Href, item.MediaType, props))
	}

	var spineBuilder strings.Builder
	for _, item := range spine {
		spineBuilder.WriteString(fmt.Sprintf(`    <itemref idref="%s" />`+"\n", item.ID))
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
	}
	if strings.TrimSpace(metadata.SeriesIndex) != "" {
		extraMetadata.WriteString(fmt.Sprintf("    <meta property=\"group-position\">%s</meta>\n", escapeXML(metadata.SeriesIndex)))
	}
	if hasCover {
		extraMetadata.WriteString("    <meta name=\"cover\" content=\"cover-image\" />\n")
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

func createNavXML(items []createSpineItem) string {
	var links strings.Builder
	for _, item := range items {
		links.WriteString(fmt.Sprintf(`      <li><a href="%s">%s</a></li>`+"\n", item.Href, escapeXML(item.Title)))
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
