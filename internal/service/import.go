package service

import (
	"archive/zip"
	"epubforge/internal/models"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

func (s *Service) ImportTxt(req models.ImportTxtRequest) (string, error) {
	return s.ImportText(req.Title, []byte(req.Content), req.RegexPattern)
}

func (s *Service) ImportText(filename string, fileBytes []byte, customRegex string) (string, error) {
	if len(fileBytes) == 0 {
		return "", errors.New("file is empty")
	}

	content := string(fileBytes)

	content = strings.ReplaceAll(content, "\r\n", "\n")
	content = strings.TrimPrefix(content, "\uFEFF")

	title := strings.TrimSuffix(filepath.Base(filename), filepath.Ext(filename))

	var re *regexp.Regexp
	if strings.TrimSpace(customRegex) != "" {
		var err error
		re, err = regexp.Compile("(?m)" + customRegex)
		if err != nil {
			return "", fmt.Errorf("biểu thức chính quy không hợp lệ: %w", err)
		}
	} else {
		pattern := `^(?i)(?:quyển\s+\d+|vol(?:ume)?\.?\s*\d+)?\s*(?:-\s*)?(?:chương|chuong|tiết|tiet|phần|phan|tập|tap)\s*(?:[+-]?\d+|[ivxldcm]+)(?:\b|:|\s|$)`
		re = regexp.MustCompile("(?m)" + pattern)
	}

	matches := re.FindAllStringIndex(content, -1)

	type TextChapter struct {
		Title   string
		Content string
	}

	var chapters []TextChapter

	if len(matches) == 0 {
		chapters = append(chapters, TextChapter{
			Title:   "Chương 1",
			Content: content,
		})
	} else {
		if matches[0][0] > 0 {
			preamble := strings.TrimSpace(content[:matches[0][0]])
			if len(preamble) > 0 {
				chapters = append(chapters, TextChapter{
					Title:   "Mở đầu",
					Content: preamble,
				})
			}
		}

		for i, match := range matches {
			start := match[0]
			end := len(content)
			if i+1 < len(matches) {
				end = matches[i+1][0]
			}

			chapterText := content[start:end]

			firstLineEnd := strings.Index(chapterText, "\n")
			var chapterTitle string
			var bodyText string
			if firstLineEnd != -1 {
				chapterTitle = strings.TrimSpace(chapterText[:firstLineEnd])
				bodyText = chapterText[firstLineEnd+1:]
			} else {
				chapterTitle = strings.TrimSpace(chapterText)
				bodyText = ""
			}

			if chapterTitle == "" {
				chapterTitle = fmt.Sprintf("Chương %d", len(chapters)+1)
			}

			chapters = append(chapters, TextChapter{
				Title:   chapterTitle,
				Content: bodyText,
			})
		}
	}

	cleanTitle := sanitizeFileName(title)
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

	styleCSS := `body {
  font-family: sans-serif;
  margin: 5% 5% 5% 5%;
  line-height: 1.5;
}
h2 {
  text-align: center;
  margin-top: 10%;
  margin-bottom: 5%;
}
p {
  text-indent: 1.5em;
  margin: 0.5em 0;
  text-align: justify;
}`
	sw, err := zw.CreateHeader(&zip.FileHeader{
		Name:   "OEBPS/Styles/style.css",
		Method: zip.Deflate,
	})
	if err != nil {
		return "", err
	}
	if _, err := sw.Write([]byte(styleCSS)); err != nil {
		return "", err
	}

	type ChapterMeta struct {
		ID   string
		Path string
	}
	var chapMetas []ChapterMeta

	for idx, chap := range chapters {
		var bodyBuilder strings.Builder
		paragraphs := strings.Split(chap.Content, "\n")
		for _, p := range paragraphs {
			p = strings.TrimSpace(p)
			if p != "" {
				bodyBuilder.WriteString(fmt.Sprintf("  <p>%s</p>\n", escapeXML(p)))
			}
		}

		htmlContent := fmt.Sprintf(`<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
  <title>%s</title>
  <link rel="stylesheet" type="text/css" href="../Styles/style.css" />
</head>
<body>
  <h2>%s</h2>
%s</body>
</html>`, escapeXML(chap.Title), escapeXML(chap.Title), bodyBuilder.String())

		fileName := fmt.Sprintf("chapter_%d.xhtml", idx+1)
		fullPath := "OEBPS/Text/" + fileName

		chw, err := zw.CreateHeader(&zip.FileHeader{
			Name:   fullPath,
			Method: zip.Deflate,
		})
		if err != nil {
			return "", err
		}
		if _, err := chw.Write([]byte(htmlContent)); err != nil {
			return "", err
		}

		chapMetas = append(chapMetas, ChapterMeta{
			ID:   fmt.Sprintf("chapter_%d", idx+1),
			Path: "Text/" + fileName,
		})
	}

	var manifestItems []string
	var spineItems []string
	manifestItems = append(manifestItems, `    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml" />`)
	manifestItems = append(manifestItems, `    <item id="style" href="Styles/style.css" media-type="text/css" />`)

	for _, meta := range chapMetas {
		manifestItems = append(manifestItems, fmt.Sprintf(`    <item id="%s" href="%s" media-type="application/xhtml+xml" />`, meta.ID, meta.Path))
		spineItems = append(spineItems, fmt.Sprintf(`    <itemref idref="%s" />`, meta.ID))
	}

	opfXML := fmt.Sprintf(`<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="pub-id" version="2.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
    <dc:title>%s</dc:title>
    <dc:creator>EPUBForge</dc:creator>
    <dc:language>vi</dc:language>
    <dc:identifier id="pub-id">uuid-%s</dc:identifier>
  </metadata>
  <manifest>
%s
  </manifest>
  <spine toc="ncx">
%s
  </spine>
</package>`, escapeXML(title), randomID(), strings.Join(manifestItems, "\n"), strings.Join(spineItems, "\n"))

	ow, err := zw.CreateHeader(&zip.FileHeader{
		Name:   "OEBPS/content.opf",
		Method: zip.Deflate,
	})
	if err != nil {
		return "", err
	}
	if _, err := ow.Write([]byte(opfXML)); err != nil {
		return "", err
	}

	var ncxPoints []string
	for idx, chap := range chapters {
		np := fmt.Sprintf(`    <navPoint id="nav-%d" playOrder="%d">
      <navLabel><text>%s</text></navLabel>
      <content src="%s" />
    </navPoint>`, idx+1, idx+1, escapeXML(chap.Title), chapMetas[idx].Path)
		ncxPoints = append(ncxPoints, np)
	}

	ncxXML := fmt.Sprintf(`<?xml version="1.0" encoding="utf-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="%s" />
    <meta name="dtb:depth" content="1" />
    <meta name="dtb:totalPageCount" content="0" />
    <meta name="dtb:maxPageNumber" content="0" />
  </head>
  <docTitle><text>%s</text></docTitle>
  <navMap>
%s
  </navMap>
</ncx>`, randomID(), escapeXML(title), strings.Join(ncxPoints, "\n"))

	nw, err := zw.CreateHeader(&zip.FileHeader{
		Name:   "OEBPS/toc.ncx",
		Method: zip.Deflate,
	})
	if err != nil {
		return "", err
	}
	if _, err := nw.Write([]byte(ncxXML)); err != nil {
		return "", err
	}

	if err := zw.Close(); err != nil {
		return "", fmt.Errorf("lỗi đóng file zip: %w", err)
	}

	return outputName, nil
}
