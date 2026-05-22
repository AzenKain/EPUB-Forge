package service

import (
	"archive/zip"
	"bytes"
	"epubforge/internal/models"
	"fmt"
	"image"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

func (s *Service) CreateManga(title, author, direction string, images []models.UploadedMangaImage) (string, error) {
	if len(images) == 0 {
		return "", fmt.Errorf("no manga images were uploaded")
	}

	sort.Slice(images, func(i, j int) bool {
		return strings.Compare(strings.ToLower(images[i].Filename), strings.ToLower(images[j].Filename)) < 0
	})

	title = strings.TrimSpace(title)
	if title == "" {
		title = "manga_book"
	}
	author = strings.TrimSpace(author)
	if author == "" {
		author = "Khuyet danh"
	}
	if strings.ToLower(strings.TrimSpace(direction)) != "rtl" {
		direction = "ltr"
	} else {
		direction = "rtl"
	}

	outputName, outputPath := uniqueCreateOutputPath(title)
	out, err := os.Create(outputPath)
	if err != nil {
		return "", fmt.Errorf("cannot create EPUB file: %w", err)
	}
	defer out.Close()

	zw := zip.NewWriter(out)

	if err := writeStoredMimetype(zw); err != nil {
		_ = zw.Close()
		return "", err
	}
	if err := writeZipText(zw, "META-INF/container.xml", createContainerXML); err != nil {
		_ = zw.Close()
		return "", err
	}

	type mangaPage struct {
		PageID   string
		PageHref string
		ImgID    string
		ImgHref  string
		Title    string
	}

	pages := make([]mangaPage, 0, len(images))
	for idx, img := range images {
		pageNum := idx + 1
		ext := strings.ToLower(filepath.Ext(img.Filename))
		if ext == "" {
			ext = ".jpg"
		}

		imgName := fmt.Sprintf("page_%03d%s", pageNum, ext)
		imgHref := "Images/" + imgName
		if err := writeZipBytes(zw, "OEBPS/"+imgHref, img.Data); err != nil {
			_ = zw.Close()
			return "", fmt.Errorf("cannot write image %s: %w", img.Filename, err)
		}

		width, height := 800, 1200
		if cfg, _, err := image.DecodeConfig(bytes.NewReader(img.Data)); err == nil && cfg.Width > 0 && cfg.Height > 0 {
			width = cfg.Width
			height = cfg.Height
		}

		pageID := fmt.Sprintf("page_%03d", pageNum)
		pageHref := fmt.Sprintf("Text/%s.xhtml", pageID)
		pageTitle := fmt.Sprintf("Page %03d", pageNum)
		pageHTML := fmt.Sprintf(`<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
  <title>%s</title>
  <meta name="viewport" content="width=%d, height=%d" />
  <style type="text/css">
    body { margin: 0; padding: 0; background-color: #000000; }
    img { width: 100%%; height: 100%%; display: block; object-fit: contain; }
  </style>
</head>
<body>
  <div>
    <img src="../%s" alt="%s" />
  </div>
</body>
</html>`, escapeXML(pageTitle), width, height, escapeXML(imgHref), escapeXML(pageTitle))
		if err := writeZipText(zw, "OEBPS/"+pageHref, pageHTML); err != nil {
			_ = zw.Close()
			return "", err
		}

		pages = append(pages, mangaPage{
			PageID:   pageID,
			PageHref: pageHref,
			ImgID:    fmt.Sprintf("img_%03d", pageNum),
			ImgHref:  imgHref,
			Title:    pageTitle,
		})
	}

	var manifestBuilder strings.Builder
	var spineBuilder strings.Builder
	manifestBuilder.WriteString(`    <item id="nav" href="Text/nav.xhtml" media-type="application/xhtml+xml" properties="nav" />` + "\n")
	manifestBuilder.WriteString(`    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml" />` + "\n")
	for _, p := range pages {
		manifestBuilder.WriteString(fmt.Sprintf(`    <item id="%s" href="%s" media-type="application/xhtml+xml" />`+"\n",
			escapeXML(p.PageID), escapeXML(p.PageHref)))
		manifestBuilder.WriteString(fmt.Sprintf(`    <item id="%s" href="%s" media-type="%s" />`+"\n",
			escapeXML(p.ImgID), escapeXML(p.ImgHref), escapeXML(imageMediaType(filepath.Ext(p.ImgHref)))))
		spineBuilder.WriteString(fmt.Sprintf(`    <itemref idref="%s" />`+"\n", escapeXML(p.PageID)))
	}

	uuidID := "uuid-" + randomID()
	opfXML := fmt.Sprintf(`<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="pub-id" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>%s</dc:title>
    <dc:creator id="creator">%s</dc:creator>
    <dc:language>vi</dc:language>
    <dc:identifier id="pub-id">%s</dc:identifier>
    <meta property="dcterms:modified">%s</meta>
    <meta property="rendition:layout">pre-paginated</meta>
    <meta property="rendition:orientation">auto</meta>
    <meta property="rendition:spread">auto</meta>
  </metadata>
  <manifest>
%s  </manifest>
  <spine toc="ncx" page-progression-direction="%s">
%s  </spine>
</package>`, escapeXML(title), escapeXML(author), uuidID, time.Now().UTC().Format("2006-01-02T15:04:05Z"), manifestBuilder.String(), direction, spineBuilder.String())
	if err := writeZipText(zw, "OEBPS/content.opf", opfXML); err != nil {
		_ = zw.Close()
		return "", err
	}

	var tocItems []createSpineItem
	for _, p := range pages {
		tocItems = append(tocItems, createSpineItem{ID: p.PageID, Href: p.PageHref, Title: p.Title})
	}
	if err := writeZipText(zw, "OEBPS/toc.ncx", createNCXXML(title, uuidID, tocItems)); err != nil {
		_ = zw.Close()
		return "", err
	}
	if err := writeZipText(zw, "OEBPS/Text/nav.xhtml", createNavXMLAt("Text/nav.xhtml", tocItems)); err != nil {
		_ = zw.Close()
		return "", err
	}

	if err := zw.Close(); err != nil {
		return "", fmt.Errorf("cannot close EPUB zip: %w", err)
	}
	return outputName, nil
}
