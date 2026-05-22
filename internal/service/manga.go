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
)

func (s *Service) CreateManga(title, author, direction string, images []models.UploadedMangaImage) (string, error) {
	if len(images) == 0 {
		return "", fmt.Errorf("không có ảnh nào được tải lên")
	}

	sort.Slice(images, func(i, j int) bool {
		return strings.Compare(strings.ToLower(images[i].Filename), strings.ToLower(images[j].Filename)) < 0
	})

	cleanTitle := sanitizeFileName(title)
	if cleanTitle == "" {
		cleanTitle = "manga_book"
	}
	outputName := cleanTitle + ".epub"
	outputPath := filepath.Join(editDir, outputName)

	counter := 1
	for {
		if _, err := os.Stat(outputPath); os.IsNotExist(err) {
			break
		}
		outputName = fmt.Sprintf("%s (%d).epub", cleanTitle, counter)
		outputPath = filepath.Join(editDir, outputName)
		counter++
	}

	out, err := os.Create(outputPath)
	if err != nil {
		return "", fmt.Errorf("không thể tạo file EPUB mới: %w", err)
	}
	defer out.Close()

	zw := zip.NewWriter(out)
	defer zw.Close()

	mimetypeHeader := &zip.FileHeader{
		Name:   "mimetype",
		Method: zip.Store,
	}
	mimetypeHeader.SetMode(0644)
	mw, err := zw.CreateHeader(mimetypeHeader)
	if err != nil {
		return "", err
	}
	if _, err := mw.Write([]byte("application/epub+zip")); err != nil {
		return "", err
	}

	containerXML := `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`
	cw, err := zw.CreateHeader(&zip.FileHeader{
		Name:   "META-INF/container.xml",
		Method: zip.Deflate,
	})
	if err != nil {
		return "", err
	}
	if _, err := cw.Write([]byte(containerXML)); err != nil {
		return "", err
	}

	type MangaPage struct {
		PageID   string
		PageHref string
		ImgID    string
		ImgHref  string
		ImgPath  string
		Title    string
	}

	var pages []MangaPage

	for idx, img := range images {
		pageNum := idx + 1
		ext := filepath.Ext(img.Filename)
		if ext == "" {
			ext = ".jpg"
		}

		imgName := fmt.Sprintf("page_%03d%s", pageNum, ext)
		imgHref := "Images/" + imgName
		imgFullPath := "OEBPS/" + imgHref

		iw, err := zw.CreateHeader(&zip.FileHeader{
			Name:   imgFullPath,
			Method: zip.Deflate,
		})
		if err != nil {
			return "", fmt.Errorf("lỗi khi tạo header cho ảnh %s: %w", img.Filename, err)
		}
		if _, err := iw.Write(img.Data); err != nil {
			return "", fmt.Errorf("lỗi khi ghi dữ liệu ảnh %s: %w", img.Filename, err)
		}

		width, height := 800, 1200
		imgConfig, _, imgErr := image.DecodeConfig(bytes.NewReader(img.Data))
		if imgErr == nil && imgConfig.Width > 0 && imgConfig.Height > 0 {
			width = imgConfig.Width
			height = imgConfig.Height
		}

		pageName := fmt.Sprintf("page_%03d.xhtml", pageNum)
		pageHref := "Text/" + pageName
		pageFullPath := "OEBPS/" + pageHref

		pageTitle := fmt.Sprintf("Trang %03d", pageNum)
		pageHTML := fmt.Sprintf(`<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
  <title>%s</title>
  <meta name="viewport" content="width=%d, height=%d" />
  <style type="text/css">
    body {
      margin: 0;
      padding: 0;
      background-color: #000000;
    }
    img {
      width: 100%%;
      height: 100%%;
      display: block;
    }
  </style>
</head>
<body>
  <div>
    <img src="../%s" alt="%s" />
  </div>
</body>
</html>`, pageTitle, width, height, imgHref, pageTitle)

		pw, err := zw.CreateHeader(&zip.FileHeader{
			Name:   pageFullPath,
			Method: zip.Deflate,
		})
		if err != nil {
			return "", fmt.Errorf("lỗi khi tạo page wrapper cho trang %d: %w", pageNum, err)
		}
		if _, err := pw.Write([]byte(pageHTML)); err != nil {
			return "", err
		}

		pages = append(pages, MangaPage{
			PageID:   fmt.Sprintf("page_%03d", pageNum),
			PageHref: pageHref,
			ImgID:    fmt.Sprintf("img_%03d", pageNum),
			ImgHref:  imgHref,
			ImgPath:  imgFullPath,
			Title:    pageTitle,
		})
	}

	var manifestBuilder strings.Builder
	var spineBuilder strings.Builder

	manifestBuilder.WriteString(`    <item id="nav" href="Text/nav.xhtml" media-type="application/xhtml+xml" properties="nav" />`+"\n")
	manifestBuilder.WriteString(`    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml" />`+"\n")

	for _, p := range pages {
		ext := filepath.Ext(p.ImgHref)
		mediaType := "image/jpeg"
		switch strings.ToLower(ext) {
		case ".png":
			mediaType = "image/png"
		case ".gif":
			mediaType = "image/gif"
		case ".webp":
			mediaType = "image/webp"
		}

		manifestBuilder.WriteString(fmt.Sprintf(`    <item id="%s" href="%s" media-type="application/xhtml+xml" />`+"\n", p.PageID, p.PageHref))
		manifestBuilder.WriteString(fmt.Sprintf(`    <item id="%s" href="%s" media-type="%s" />`+"\n", p.ImgID, p.ImgHref, mediaType))

		spineBuilder.WriteString(fmt.Sprintf(`    <itemref idref="%s" />`+"\n", p.PageID))
	}

	if direction != "rtl" {
		direction = "ltr"
	}

	escTitle := escapeXML(title)
	escAuthor := escapeXML(author)
	uuidID := "uuid-" + randomID()

	opfXML := fmt.Sprintf(`<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="pub-id" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>%s</dc:title>
    <dc:creator id="creator">%s</dc:creator>
    <dc:language>vi</dc:language>
    <dc:identifier id="pub-id">%s</dc:identifier>
    <meta property="dcterms:modified">2026-05-22T00:00:00Z</meta>
    <meta property="rendition:layout">pre-paginated</meta>
    <meta property="rendition:orientation">auto</meta>
    <meta property="rendition:spread">auto</meta>
  </metadata>
  <manifest>
%s  </manifest>
  <spine toc="ncx" page-progression-direction="%s">
%s  </spine>
</package>`, escTitle, escAuthor, uuidID, manifestBuilder.String(), direction, spineBuilder.String())

	opfHeader := &zip.FileHeader{
		Name:   "OEBPS/content.opf",
		Method: zip.Deflate,
	}
	opfw, err := zw.CreateHeader(opfHeader)
	if err != nil {
		return "", err
	}
	if _, err := opfw.Write([]byte(opfXML)); err != nil {
		return "", err
	}

	var ncxPointsBuilder strings.Builder
	for idx, p := range pages {
		ncxPointsBuilder.WriteString(fmt.Sprintf(`  <navPoint id="%s" playOrder="%d">
    <navLabel>
      <text>%s</text>
    </navLabel>
    <content src="%s" />
  </navPoint>`+"\n", p.PageID, idx+1, p.Title, p.PageHref))
	}

	ncxXML := fmt.Sprintf(`<?xml version="1.0" encoding="utf-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="%s" />
    <meta name="dtb:depth" content="1" />
    <meta name="dtb:totalPageCount" content="0" />
    <meta name="dtb:maxPageNumber" content="0" />
  </head>
  <docTitle>
    <text>%s</text>
  </docTitle>
  <navMap>
%s  </navMap>
</ncx>`, uuidID, escTitle, ncxPointsBuilder.String())

	ncxw, err := zw.CreateHeader(&zip.FileHeader{
		Name:   "OEBPS/toc.ncx",
		Method: zip.Deflate,
	})
	if err != nil {
		return "", err
	}
	if _, err := ncxw.Write([]byte(ncxXML)); err != nil {
		return "", err
	}

	var navLinksBuilder strings.Builder
	for _, p := range pages {
		navLinksBuilder.WriteString(fmt.Sprintf(`        <li><a href="%s">%s</a></li>`+"\n", p.PageHref, p.Title))
	}

	navXML := fmt.Sprintf(`<?xml version="1.0" encoding="utf-8"?>
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
</html>`, navLinksBuilder.String())

	navw, err := zw.CreateHeader(&zip.FileHeader{
		Name:   "OEBPS/Text/nav.xhtml",
		Method: zip.Deflate,
	})
	if err != nil {
		return "", err
	}
	if _, err := navw.Write([]byte(navXML)); err != nil {
		return "", err
	}

	return outputName, nil
}
