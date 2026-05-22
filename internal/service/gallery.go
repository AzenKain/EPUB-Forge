package service

import (
	"archive/zip"
	"fmt"
	"io"
	"os"
	"regexp"
	"sort"
	"strings"

	"epubforge/internal/models"
)

func (s *Service) GetGallery(id string) (models.GalleryResponse, error) {
	lock := s.getBookLock(id)
	lock.Lock()
	defer lock.Unlock()

	ctx, err := loadBook(id)
	if err != nil {
		return models.GalleryResponse{}, err
	}
	defer ctx.Close()

	var available []models.GalleryImage
	for _, item := range ctx.Manifest {
		if strings.HasPrefix(strings.ToLower(item.MediaType), "image/") {
			available = append(available, models.GalleryImage{
				FullPath: item.FullPath,
				Href:     item.Href,
				Caption:  "",
				Selected: false,
				Order:    0,
			})
		}
	}
	sort.Slice(available, func(i, j int) bool {
		return strings.Compare(available[i].FullPath, available[j].FullPath) < 0
	})

	var galleryItem *ManifestItem
	for _, item := range ctx.Manifest {
		lower := strings.ToLower(item.FullPath)
		if strings.HasSuffix(lower, "gallery.xhtml") {
			copyItem := item
			galleryItem = &copyItem
			break
		}
	}

	var selected []models.GalleryImage
	if galleryItem != nil {
		htmlStr, err := ctx.readText(galleryItem.FullPath)
		if err == nil {
			selected = parseGalleryHTML(htmlStr, galleryItem.FullPath, ctx.ManifestByPath)
			for i, av := range available {
				for selIdx, sel := range selected {
					if av.FullPath == sel.FullPath {
						available[i].Selected = true
						available[i].Caption = sel.Caption
						available[i].Order = selIdx
						break
					}
				}
			}
		}
	}

	if selected == nil {
		selected = []models.GalleryImage{}
	}

	return models.GalleryResponse{
		AvailableImages: available,
		SelectedImages:  selected,
	}, nil
}

func parseGalleryHTML(htmlStr string, galleryPath string, manifestByPath map[string]ManifestItem) []models.GalleryImage {
	var selected []models.GalleryImage
	galleryDir := posixDir(galleryPath)

	reItemBlock := regexp.MustCompile(`(?is)<div\b[^>]*\bclass=["']gallery-item["'][^>]*>(.*?)</div>`)
	reImg := regexp.MustCompile(`(?is)<img\b[^>]*\bsrc=["']([^"']+)["']`)
	reCaption := regexp.MustCompile(`(?is)<div\b[^>]*\bclass=["']gallery-caption["'][^>]*>(.*?)</div>`)

	blocks := reItemBlock.FindAllStringSubmatch(htmlStr, -1)
	orderCounter := 0
	for _, block := range blocks {
		inner := block[1]
		imgMatch := reImg.FindStringSubmatch(inner)
		if len(imgMatch) < 2 {
			continue
		}
		imgSrc := imgMatch[1]
		resolvedFullPath := resolveZipHref(galleryDir, imgSrc)

		caption := ""
		capMatch := reCaption.FindStringSubmatch(inner)
		if len(capMatch) >= 2 {
			caption = strings.TrimSpace(capMatch[1])
		}

		selected = append(selected, models.GalleryImage{
			FullPath: resolvedFullPath,
			Href:     imgSrc,
			Caption:  caption,
			Selected: true,
			Order:    orderCounter,
		})
		orderCounter++
	}

	return selected
}

func (s *Service) SaveGallery(id string, req models.SaveGalleryRequest) (models.BookAnalysis, error) {
	lock := s.getBookLock(id)
	lock.Lock()
	defer lock.Unlock()

	ctx, err := loadBook(id)
	if err != nil {
		return models.BookAnalysis{}, err
	}
	defer ctx.Close()

	var galleryDir string
	if len(ctx.Chapters) > 0 {
		galleryDir = posixDir(ctx.Chapters[0].Path)
	} else {
		galleryDir = ctx.OPFDir
		if galleryDir == "" {
			galleryDir = "OEBPS/Text"
		} else {
			galleryDir = galleryDir + "/Text"
		}
	}
	galleryFullPath := normalizeZipPath(galleryDir + "/gallery.xhtml")
	galleryRelHref := relativeZipPath(ctx.OPFPath, galleryFullPath)

	var itemsBuilder strings.Builder
	for _, img := range req.Images {
		imgRelSrc := relativeZipPath(galleryFullPath, img.FullPath)
		escCaption := escapeXML(img.Caption)

		itemsBuilder.WriteString(fmt.Sprintf(`    <div class="gallery-item">
      <img src="%s" alt="%s" />`+"\n", imgRelSrc, escCaption))
		if img.Caption != "" {
			itemsBuilder.WriteString(fmt.Sprintf(`      <div class="gallery-caption">%s</div>`+"\n", escCaption))
		}
		itemsBuilder.WriteString("    </div>\n")
	}

	galleryHTML := fmt.Sprintf(`<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
  <title>Ảnh Minh Họa</title>
  <style type="text/css">
    body {
      margin: 0;
      padding: 20px;
      background-color: #111111;
      color: #eeeeee;
      font-family: sans-serif;
      text-align: center;
    }
    .gallery-title {
      font-size: 1.8em;
      margin-bottom: 30px;
      font-weight: bold;
    }
    .gallery-container {
      display: flex;
      flex-direction: column;
      gap: 30px;
      align-items: center;
    }
    .gallery-item {
      max-width: 100%%;
      text-align: center;
      page-break-inside: avoid;
    }
    .gallery-item img {
      max-width: 100%%;
      max-height: 90vh;
      border-radius: 4px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.5);
    }
    .gallery-caption {
      margin-top: 10px;
      font-size: 0.9em;
      font-style: italic;
      color: #cccccc;
    }
  </style>
</head>
<body>
  <div class="gallery-title">Ảnh Minh Họa</div>
  <div class="gallery-container">
%s  </div>
</body>
</html>`, itemsBuilder.String())

	editedFiles := map[string][]byte{
		galleryFullPath: []byte(galleryHTML),
	}

	opfXML := ctx.OPFXML
	galleryID := "gallery"

	for _, item := range ctx.Manifest {
		if item.FullPath == galleryFullPath {
			galleryID = item.ID
			break
		}
	}

	opfXML = ctx.addOrUpdateManifestItem(opfXML, galleryID, galleryRelHref, "application/xhtml+xml")
	opfXML = ctx.addOrUpdateSpineRef(opfXML, galleryID)
	editedFiles[ctx.OPFPath] = []byte(opfXML)

	var ncxXML string
	var ncxPath string
	if ctx.NCX != nil {
		ncxPath = ctx.NCX.FullPath
		var errRead error
		ncxXML, errRead = ctx.readText(ncxPath)
		if errRead == nil {
			var updatedTOC []TocPoint
			galleryInTOC := false
			galleryTocPoint := TocPoint{
				Title:    "Ảnh Minh Họa",
				Src:      relativeZipPath(ncxPath, galleryFullPath),
				FullPath: galleryFullPath,
			}

			for _, pt := range ctx.TOC {
				if pt.FullPath == galleryFullPath {
					updatedTOC = append(updatedTOC, galleryTocPoint)
					galleryInTOC = true
				} else {
					updatedTOC = append(updatedTOC, pt)
				}
			}

			if !galleryInTOC {
				insertIdx := 0
				if len(updatedTOC) > 0 && (strings.Contains(strings.ToLower(updatedTOC[0].FullPath), "cover") || strings.Contains(strings.ToLower(updatedTOC[0].FullPath), "title")) {
					insertIdx = 1
				}

				if insertIdx >= len(updatedTOC) {
					updatedTOC = append(updatedTOC, galleryTocPoint)
				} else {
					updatedTOC = append(updatedTOC[:insertIdx], append([]TocPoint{galleryTocPoint}, updatedTOC[insertIdx:]...)...)
				}
			}

			ncxXML = ctx.rebuildNCXFromTOC(ncxPath, updatedTOC, ctx.Title)
			ncxXML = renumberPlayOrder(ncxXML)
			editedFiles[ncxPath] = []byte(ncxXML)
		}
	}

	var navPath string
	var navHTML string
	for _, item := range ctx.Manifest {
		if strings.Contains(strings.ToLower(item.MediaType), "properties") && strings.Contains(strings.ToLower(item.Attrs["properties"]), "nav") {
			navPath = item.FullPath
			var errRead error
			navHTML, errRead = ctx.readText(navPath)
			if errRead != nil {
				navPath = ""
			}
			break
		}
	}
	if navPath == "" {
		for _, item := range ctx.Manifest {
			lower := strings.ToLower(item.FullPath)
			if strings.HasSuffix(lower, "nav.xhtml") || strings.HasSuffix(lower, "toc.html") || strings.HasSuffix(lower, "nav.html") || strings.HasSuffix(lower, "index.html") {
				navPath = item.FullPath
				var errRead error
				navHTML, errRead = ctx.readText(navPath)
				if errRead != nil {
					navPath = ""
				}
				break
			}
		}
	}

	if navPath != "" && navHTML != "" {
		navHTML = insertGalleryToNav(navHTML, relativeZipPath(navPath, galleryFullPath), "Ảnh Minh Họa")
		editedFiles[navPath] = []byte(navHTML)
	}

	tmp := ctx.FilePath + ".tmp"
	out, err := os.Create(tmp)
	if err != nil {
		return models.BookAnalysis{}, err
	}
	zw := zip.NewWriter(out)

	for _, f := range ctx.Reader.File {
		if content, ok := editedFiles[f.Name]; ok {
			w, err := zw.CreateHeader(&zip.FileHeader{
				Name:   f.Name,
				Method: zip.Deflate,
			})
			if err != nil {
				return closeGalleryZipErr(zw, out, tmp, err)
			}
			if _, err := w.Write(content); err != nil {
				return closeGalleryZipErr(zw, out, tmp, err)
			}
		} else {
			rc, err := f.Open()
			if err != nil {
				return closeGalleryZipErr(zw, out, tmp, err)
			}
			w, err := zw.CreateHeader(&zip.FileHeader{
				Name:   f.Name,
				Method: f.Method,
			})
			if err != nil {
				_ = rc.Close()
				return closeGalleryZipErr(zw, out, tmp, err)
			}
			_, err = io.Copy(w, rc)
			_ = rc.Close()
			if err != nil {
				return closeGalleryZipErr(zw, out, tmp, err)
			}
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
			w, err := zw.CreateHeader(header)
			if err != nil {
				return closeGalleryZipErr(zw, out, tmp, err)
			}
			if _, err := w.Write(content); err != nil {
				return closeGalleryZipErr(zw, out, tmp, err)
			}
		}
	}

	if err := zw.Close(); err != nil {
		_ = out.Close()
		_ = os.Remove(tmp)
		return models.BookAnalysis{}, err
	}
	if err := out.Close(); err != nil {
		_ = os.Remove(tmp)
		return models.BookAnalysis{}, err
	}

	_ = ctx.Reader.Close()
	ctx.Reader = nil

	if err := os.Remove(ctx.FilePath); err != nil {
		_ = os.Remove(tmp)
		return models.BookAnalysis{}, err
	}
	if err := os.Rename(tmp, ctx.FilePath); err != nil {
		_ = os.Remove(tmp)
		return models.BookAnalysis{}, err
	}

	newCtx, err := loadBook(id)
	if err != nil {
		return models.BookAnalysis{}, err
	}
	defer newCtx.Close()

	return newCtx.Analysis(), nil
}

func closeGalleryZipErr(zw *zip.Writer, out *os.File, tmp string, err error) (models.BookAnalysis, error) {
	_ = zw.Close()
	_ = out.Close()
	_ = os.Remove(tmp)
	return models.BookAnalysis{}, err
}

func (ctx *BookContext) addOrUpdateManifestItem(opfXML, id, href, mediaType string) string {
	reItem := regexp.MustCompile(fmt.Sprintf(`(?is)<item\b[^>]*\bid\s*=\s*["']%s["'][^>]*/>`, regexp.QuoteMeta(id)))
	newItemTag := fmt.Sprintf(`<item id="%s" href="%s" media-type="%s" />`, id, href, mediaType)

	if reItem.MatchString(opfXML) {
		return reItem.ReplaceAllString(opfXML, newItemTag)
	}

	manifestMatch := manifestRe.FindStringSubmatch(opfXML)
	if len(manifestMatch) >= 4 {
		return replaceXMLBlock(manifestRe, opfXML, manifestMatch[2]+"\n    "+newItemTag)
	}
	return opfXML
}

func (ctx *BookContext) addOrUpdateSpineRef(opfXML, id string) string {
	reRef := regexp.MustCompile(fmt.Sprintf(`(?is)<itemref\b[^>]*\bidref\s*=\s*["']%s["'][^>]*/>`, regexp.QuoteMeta(id)))
	if reRef.MatchString(opfXML) {
		return opfXML
	}

	insertIndex := 0
	if len(ctx.Spine) > 0 && (strings.Contains(strings.ToLower(ctx.Spine[0].IDRef), "cover") || strings.Contains(strings.ToLower(ctx.Spine[0].IDRef), "title")) {
		insertIndex = 1
	}

	spineMatch := spineRe.FindStringSubmatch(opfXML)
	if len(spineMatch) >= 4 {
		spineBody := spineMatch[2]
		itemrefMatches := itemrefRe.FindAllString(spineBody, -1)
		newItemref := fmt.Sprintf(`<itemref idref="%s" />`, id)

		var newSpineBody string
		if len(itemrefMatches) == 0 {
			newSpineBody = "\n    " + newItemref
		} else if insertIndex >= len(itemrefMatches) {
			newSpineBody = spineBody + "\n    " + newItemref
		} else {
			targetRef := itemrefMatches[insertIndex]
			idx := strings.Index(spineBody, targetRef)
			newSpineBody = spineBody[:idx] + newItemref + "\n    " + spineBody[idx:]
		}
		return replaceXMLBlock(spineRe, opfXML, newSpineBody)
	}
	return opfXML
}

func insertGalleryToNav(navHTML, galleryRelHref, title string) string {
	if strings.Contains(navHTML, galleryRelHref) {
		return navHTML
	}

	liIdx := strings.Index(strings.ToLower(navHTML), "<li")
	if liIdx == -1 {
		olIdx := strings.Index(strings.ToLower(navHTML), "<ol")
		if olIdx != -1 {
			tagEnd := strings.Index(navHTML[olIdx:], ">")
			if tagEnd != -1 {
				insertIdx := olIdx + tagEnd + 1
				li := fmt.Sprintf("\n      <li><a href=\"%s\">%s</a></li>", galleryRelHref, title)
				return navHTML[:insertIdx] + li + navHTML[insertIdx:]
			}
		}
		return navHTML
	}

	endIdx := findMatchingClosingTag(navHTML, liIdx, "<li", "</li>")
	if endIdx != -1 {
		firstLi := navHTML[liIdx:endIdx]
		if strings.Contains(strings.ToLower(firstLi), "cover") || strings.Contains(strings.ToLower(firstLi), "title") {
			li := fmt.Sprintf("\n      <li><a href=\"%s\">%s</a></li>", galleryRelHref, title)
			return navHTML[:endIdx] + li + navHTML[endIdx:]
		}
	}

	li := fmt.Sprintf("\n      <li><a href=\"%s\">%s</a></li>", galleryRelHref, title)
	return navHTML[:liIdx] + li + navHTML[liIdx:]
}
