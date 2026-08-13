package service

import (
	"encoding/xml"
	"fmt"
	"path"
	"regexp"
	"strconv"
	"strings"

	"epubforge/internal/models"
)

type ncxNavPoint struct {
	ID        string `xml:"id,attr"`
	PlayOrder int    `xml:"playOrder,attr"`
	Text      string `xml:"navLabel>text"`
	Content   struct {
		Src string `xml:"src,attr"`
	} `xml:"content"`
	NavPoints []ncxNavPoint `xml:"navPoint"`
}

type ncxXmlStruct struct {
	XMLName   xml.Name      `xml:"ncx"`
	NavPoints []ncxNavPoint `xml:"navMap>navPoint"`
}

func mapNavPointToTocNode(np ncxNavPoint) models.TocNode {
	node := models.TocNode{
		Title: np.Text,
		Href:  np.Content.Src,
	}
	if len(np.NavPoints) > 0 {
		node.Children = make([]models.TocNode, len(np.NavPoints))
		for i, subNp := range np.NavPoints {
			node.Children[i] = mapNavPointToTocNode(subNp)
		}
	}
	return node
}

func (s *Service) GetTOCNodes(id string) ([]models.TocNode, error) {
	lock := s.getBookLock(id)
	lock.Lock()
	defer lock.Unlock()

	ctx, err := loadBook(id)
	if err != nil {
		return nil, err
	}
	defer ctx.Close()

	if ctx.NCX == nil {
		return ctx.flatChaptersFallback(), nil
	}

	ncxXML, err := ctx.readText(ctx.NCX.FullPath)
	if err != nil {
		return ctx.flatChaptersFallback(), nil
	}

	var ncx ncxXmlStruct
	err = xml.Unmarshal([]byte(ncxXML), &ncx)
	if err != nil {
		return ctx.flatChaptersFallback(), nil
	}

	if len(ncx.NavPoints) == 0 {
		return ctx.flatChaptersFallback(), nil
	}

	nodes := make([]models.TocNode, len(ncx.NavPoints))
	for i, np := range ncx.NavPoints {
		nodes[i] = mapNavPointToTocNode(np)
	}
	return nodes, nil
}

func (ctx *BookContext) flatChaptersFallback() []models.TocNode {
	nodes := make([]models.TocNode, len(ctx.Chapters))
	for i, ch := range ctx.Chapters {
		nodes[i] = models.TocNode{Title: ch.Title, Href: ch.Href}
	}
	return nodes
}

func (s *Service) UpdateTOC(id string, nodes []models.TocNode) (BookAnalysis, error) {
	lock := s.getBookLock(id)
	lock.Lock()
	defer lock.Unlock()

	ctx, err := loadBook(id)
	if err != nil {
		return BookAnalysis{}, err
	}
	defer ctx.Close()

	if err := s.pushUndoSnapshot(id); err != nil {
		return BookAnalysis{}, err
	}

	ncxPath := ""
	if ctx.NCX != nil {
		ncxPath = ctx.NCX.FullPath
	} else {
		ncxPath = path.Join(ctx.OPFDir, "toc.ncx")
	}

	var ncxXML string
	if ctx.NCX != nil {
		var errRead error
		ncxXML, errRead = ctx.readText(ncxPath)
		if errRead != nil {
			ncxXML = ""
		}
	}

	uuidID := ""
	if ncxXML != "" {
		reUID := regexp.MustCompile(`(?i)<meta\s+name=["']dtb:uid["']\s+content=["']([^"']+)["']`)
		if m := reUID.FindStringSubmatch(ncxXML); len(m) >= 2 {
			uuidID = m[1]
		}
	}
	if uuidID == "" {
		uuidID = "uuid-" + randomID()
	}

	newNCXXML := generateNCXXML(ctx.Title, uuidID, nodes)

	var navPath string
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
	if navPath == "" {
		navPath = path.Join(ctx.OPFDir, "Text/nav.xhtml")
	}

	newNavHTML := generateNavXML(nodes, navPath, ctx.OPFDir)

	editedFiles := map[string][]byte{
		ncxPath: []byte(newNCXXML),
		navPath: []byte(newNavHTML),
	}
	for _, item := range ctx.Manifest {
		if item.FullPath == navPath || !isVisibleTOCPage(item) {
			continue
		}
		editedFiles[item.FullPath] = []byte(generateVisibleTOCXML(ctx, nodes, item.FullPath))
	}

	newFileName, err := ctx.writeEditedEPUB(editedFiles)
	if err != nil {
		return BookAnalysis{}, fmt.Errorf("không thể cập nhật mục lục: %w", err)
	}

	newID := toID(newFileName)
	newCtx, err := loadBook(newID)
	if err != nil {
		return BookAnalysis{}, err
	}
	defer newCtx.Close()

	return newCtx.Analysis(), nil
}

func generateNCXXML(title, uuidID string, nodes []models.TocNode) string {
	var sb strings.Builder
	sb.WriteString(`<?xml version="1.0" encoding="utf-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="`)
	sb.WriteString(escapeXML(uuidID))
	sb.WriteString(`" />
    <meta name="dtb:depth" content="2" />
    <meta name="dtb:totalPageCount" content="0" />
    <meta name="dtb:maxPageNumber" content="0" />
  </head>
  <docTitle><text>`)
	sb.WriteString(escapeXML(title))
	sb.WriteString(`</text></docTitle>
  <navMap>
`)

	playOrder := 1
	var writeNode func(node models.TocNode, indent string)
	writeNode = func(node models.TocNode, indent string) {
		id := fmt.Sprintf("navPoint-%d", playOrder)
		sb.WriteString(indent)
		sb.WriteString(`<navPoint id="`)
		sb.WriteString(id)
		sb.WriteString(`" playOrder="`)
		sb.WriteString(strconv.Itoa(playOrder))
		sb.WriteString(`">`)
		sb.WriteString("\n")
		playOrder++
		sb.WriteString(indent)
		sb.WriteString(`  <navLabel><text>`)
		sb.WriteString(escapeXML(node.Title))
		sb.WriteString(`</text></navLabel>`)
		sb.WriteString("\n")
		sb.WriteString(indent)
		sb.WriteString(`  <content src="`)
		sb.WriteString(escapeXML(node.Href))
		sb.WriteString(`" />`)
		sb.WriteString("\n")
		for _, child := range node.Children {
			writeNode(child, indent+"  ")
		}
		sb.WriteString(indent)
		sb.WriteString(`</navPoint>`)
		sb.WriteString("\n")
	}

	for _, node := range nodes {
		writeNode(node, "    ")
	}

	sb.WriteString(`  </navMap>
</ncx>`)
	return sb.String()
}

func generateNavXML(nodes []models.TocNode, navPath, opfDir string) string {
	var sb strings.Builder
	sb.WriteString(`<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head>
  <title>Mục lục</title>
</head>
<body>
  <nav epub:type="toc" id="toc">
    <h1>Mục lục</h1>
    <ol>
`)

	var writeNode func(node models.TocNode, indent string)
	writeNode = func(node models.TocNode, indent string) {
		fullPath := path.Join(opfDir, node.Href)
		relHref := relativeZipPath(navPath, fullPath)
		sb.WriteString(indent)
		sb.WriteString(`<li><a href="`)
		sb.WriteString(escapeXML(relHref))
		sb.WriteString(`">`)
		sb.WriteString(escapeXML(node.Title))
		sb.WriteString(`</a>`)
		if len(node.Children) > 0 {
			sb.WriteString("\n")
			sb.WriteString(indent)
			sb.WriteString("  <ol>\n")
			for _, child := range node.Children {
				writeNode(child, indent+"    ")
			}
			sb.WriteString(indent)
			sb.WriteString("  </ol>\n")
			sb.WriteString(indent)
		}
		sb.WriteString(`</li>` + "\n")
	}

	for _, node := range nodes {
		writeNode(node, "      ")
	}

	sb.WriteString(`    </ol>
  </nav>
</body>
</html>`)
	return sb.String()
}

func generateVisibleTOCXML(ctx *BookContext, nodes []models.TocNode, tocPath string) string {
	title := ctx.Title
	if title == "" {
		title = strings.TrimSuffix(ctx.FileName, ".epub")
	}

	var list strings.Builder
	var writeNode func(node models.TocNode, indent string)
	writeNode = func(node models.TocNode, indent string) {
		fullPath := normalizeZipPath(path.Join(ctx.OPFDir, node.Href))
		if item, ok := ctx.ManifestByPath[fullPath]; ok {
			if item.FullPath == tocPath || hasPropertyToken(item.Attrs["properties"], "nav") || isCoverPageItem(item) {
				return
			}
		}

		list.WriteString(indent)
		list.WriteString(`<li><a href="`)
		list.WriteString(escapeXML(relativeZipPath(tocPath, fullPath)))
		list.WriteString(`">`)
		list.WriteString(escapeXML(node.Title))
		list.WriteString(`</a>`)
		if len(node.Children) > 0 {
			list.WriteString("\n")
			list.WriteString(indent)
			list.WriteString("  <ul>\n")
			for _, child := range node.Children {
				writeNode(child, indent+"    ")
			}
			list.WriteString(indent)
			list.WriteString("  </ul>\n")
			list.WriteString(indent)
		}
		list.WriteString("</li>\n")
	}

	for _, node := range nodes {
		writeNode(node, "      ")
	}

	return fmt.Sprintf(`<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
  <title>%s</title>
  <link rel="stylesheet" type="text/css" href="%s" />
</head>
<body>
  <h1>%s</h1>
  <nav id="toc">
    <ul>
%s    </ul>
  </nav>
</body>
</html>`, escapeXML(title), escapeXML(relativeZipPath(tocPath, path.Join(ctx.OPFDir, "Styles/style.css"))), escapeXML(title), list.String())
}
