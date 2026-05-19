package service

import (
	"archive/zip"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

func (s *Service) MergeEpubs(bookIDs []string, mergedTitle string) (string, error) {
	if len(bookIDs) == 0 {
		return "", errors.New("không có sách nào để gộp")
	}
	mergedTitle = strings.TrimSpace(mergedTitle)
	if mergedTitle == "" {
		mergedTitle = "Combined Book"
	}

	
	var books []*BookContext
	for _, id := range bookIDs {
		ctx, err := loadBook(id)
		if err != nil {
			
			for _, b := range books {
				b.Close()
			}
			return "", fmt.Errorf("lỗi tải sách %s: %w", id, err)
		}
		books = append(books, ctx)
	}
	defer func() {
		for _, b := range books {
			b.Close()
		}
	}()

	
	cleanTitle := sanitizeFileName(mergedTitle)
	outputName := cleanTitle + ".epub"
	outputPath := filepath.Join(workspace, outputName)

	
	counter := 1
	for {
		if _, err := os.Stat(outputPath); os.IsNotExist(err) {
			break
		}
		outputName = fmt.Sprintf("%s (%d).epub", cleanTitle, counter)
		outputPath = filepath.Join(workspace, outputName)
		counter++
	}

	out, err := os.Create(outputPath)
	if err != nil {
		return "", fmt.Errorf("lỗi tạo file đầu ra: %w", err)
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

	
	writtenPaths := map[string]bool{"mimetype": true}

	
	type ManifestRecord struct {
		ID        string
		Href      string
		MediaType string
		Attrs     map[string]string
	}
	var masterManifest []ManifestRecord
	var masterSpine []string
	var masterTOC []TocPoint
	mergedCoverID := ""

	
	for bookIdx, book := range books {
		prefix := fmt.Sprintf("b%d_", bookIdx)
		folderPrefix := fmt.Sprintf("b%d/", bookIdx)

		
		for _, f := range book.Reader.File {
			if f.FileInfo().IsDir() {
				continue
			}
			
			lowerName := strings.ToLower(f.Name)
			if f.Name == "mimetype" ||
				strings.HasPrefix(lowerName, "meta-inf/") ||
				f.Name == book.OPFPath ||
				(book.NCX != nil && f.Name == book.NCX.FullPath) {
				continue
			}

			
			data, err := readZipFile(f)
			if err != nil {
				return "", fmt.Errorf("lỗi đọc file %s trong sách %s: %w", f.Name, book.FileName, err)
			}

			
			destPath := folderPrefix + f.Name

			
			w, err := zw.CreateHeader(&zip.FileHeader{
				Name:   destPath,
				Method: zip.Deflate,
			})
			if err != nil {
				return "", fmt.Errorf("lỗi tạo file %s trong zip gộp: %w", destPath, err)
			}
			if _, err := w.Write(data); err != nil {
				return "", fmt.Errorf("lỗi ghi file %s trong zip gộp: %w", destPath, err)
			}
			writtenPaths[destPath] = true
		}

		
		for _, item := range book.Manifest {
			
			if book.NCX != nil && item.ID == book.NCX.ID {
				continue
			}

			newID := prefix + item.ID
			newHref := folderPrefix + item.FullPath
			coverID := book.coverID()

			
			newAttrs := make(map[string]string)
			for k, v := range item.Attrs {
				newAttrs[k] = v
			}
			if bookIdx == 0 && coverID != "" && item.ID == coverID {
				mergedCoverID = newID
				newAttrs["properties"] = addPropertyToken(newAttrs["properties"], "cover-image")
			}
			if bookIdx > 0 {
				newAttrs["properties"] = removePropertyToken(newAttrs["properties"], "cover-image")
				if newAttrs["properties"] == "" {
					delete(newAttrs, "properties")
				}
			}

			masterManifest = append(masterManifest, ManifestRecord{
				ID:        newID,
				Href:      newHref,
				MediaType: item.MediaType,
				Attrs:     newAttrs,
			})
		}

		
		for _, ref := range book.Spine {
			newIDRef := prefix + ref.IDRef
			linearAttr := ""
			if !ref.Linear {
				linearAttr = ` linear="no"`
			}
			masterSpine = append(masterSpine, fmt.Sprintf(`    <itemref idref="%s"%s />`, newIDRef, linearAttr))
		}

		
		if len(book.TOC) > 0 {
			for _, pt := range book.TOC {
				var fragment string
				if idx := strings.Index(pt.Src, "#"); idx != -1 {
					fragment = pt.Src[idx:]
				}
				masterTOC = append(masterTOC, TocPoint{
					Title:    pt.Title,
					Src:      folderPrefix + pt.FullPath + fragment,
					FullPath: folderPrefix + pt.FullPath,
				})
			}
		} else {
			for _, ch := range book.Chapters {
				masterTOC = append(masterTOC, TocPoint{
					Title:    ch.Title,
					Src:      folderPrefix + ch.Path,
					FullPath: folderPrefix + ch.Path,
				})
			}
		}
	}

	
	containerXML := `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="content.opf" media-type="application/oebps-package+xml"/>
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

	
	var creatorStr string
	var langStr string
	if len(books) > 0 {
		creatorStr = books[0].Metadata.Creator
		langStr = books[0].Metadata.Language
	}
	if creatorStr == "" {
		creatorStr = "Combined Authors"
	}
	if langStr == "" {
		langStr = "vi"
	}

	var manifestBuilder strings.Builder
	
	manifestBuilder.WriteString(`    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml" />` + "\n")
	for _, rec := range masterManifest {
		propAttr := ""
		if props, ok := rec.Attrs["properties"]; ok && props != "" {
			propAttr = fmt.Sprintf(` properties="%s"`, escapeXML(props))
		}
		manifestBuilder.WriteString(fmt.Sprintf(`    <item id="%s" href="%s" media-type="%s"%s />`+"\n",
			rec.ID, escapeXML(rec.Href), rec.MediaType, propAttr))
	}

	var spineBuilder strings.Builder
	for _, refStr := range masterSpine {
		spineBuilder.WriteString(refStr + "\n")
	}

	opfXML := fmt.Sprintf(`<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="pub-id" version="2.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
    <dc:title>%s</dc:title>
    <dc:creator>%s</dc:creator>
    <dc:language>%s</dc:language>
    <dc:identifier id="pub-id">%s</dc:identifier>
%s
  </metadata>
  <manifest>
%s  </manifest>
  <spine toc="ncx">
%s  </spine>
</package>`,
		escapeXML(mergedTitle),
		escapeXML(creatorStr),
		escapeXML(langStr),
		"uuid-"+randomID(),
		coverMetaTag(mergedCoverID),
		manifestBuilder.String(),
		spineBuilder.String(),
	)

	ow, err := zw.CreateHeader(&zip.FileHeader{
		Name:   "content.opf",
		Method: zip.Deflate,
	})
	if err != nil {
		return "", err
	}
	if _, err := ow.Write([]byte(opfXML)); err != nil {
		return "", err
	}

	
	var ncxBuilder strings.Builder
	ncxBuilder.WriteString("<?xml version='1.0' encoding='utf-8'?>\n")
	ncxBuilder.WriteString(`<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">` + "\n")
	ncxBuilder.WriteString("  <head>\n")
	ncxBuilder.WriteString(`    <meta name="dtb:uid" content="` + randomID() + `"/>` + "\n")
	ncxBuilder.WriteString(`    <meta name="dtb:depth" content="1"/>` + "\n")
	ncxBuilder.WriteString(`    <meta name="dtb:totalPageCount" content="0"/>` + "\n")
	ncxBuilder.WriteString(`    <meta name="dtb:maxPageNumber" content="0"/>` + "\n")
	ncxBuilder.WriteString("  </head>\n")
	ncxBuilder.WriteString("  <docTitle><text>" + escapeXML(mergedTitle) + "</text></docTitle>\n")
	ncxBuilder.WriteString("  <navMap>\n")

	for i, pt := range masterTOC {
		ncxBuilder.WriteString(fmt.Sprintf(`    <navPoint id="nav-%d" playOrder="%d">`+"\n", i+1, i+1))
		ncxBuilder.WriteString("      <navLabel><text>" + escapeXML(pt.Title) + "</text></navLabel>\n")
		ncxBuilder.WriteString(`      <content src="` + escapeXML(pt.Src) + `"/>` + "\n")
		ncxBuilder.WriteString("    </navPoint>\n")
	}

	ncxBuilder.WriteString("  </navMap>\n</ncx>")

	nw, err := zw.CreateHeader(&zip.FileHeader{
		Name:   "toc.ncx",
		Method: zip.Deflate,
	})
	if err != nil {
		return "", err
	}
	if _, err := nw.Write([]byte(ncxBuilder.String())); err != nil {
		return "", err
	}

	
	if err := zw.Close(); err != nil {
		return "", fmt.Errorf("lỗi đóng file zip: %w", err)
	}

	return outputName, nil
}
