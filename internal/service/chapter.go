package service

import (
	"archive/zip"
	"errors"
	"fmt"
	"html"
	"io"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"unicode"

	"epubforge/internal/models"
)

func (s *Service) ChapterHTML(id string, index int, raw bool) (string, error) {
	lock := s.getBookLock(id)
	lock.Lock()
	defer lock.Unlock()

	ctx, err := loadBook(id)
	if err != nil {
		return "", err
	}
	defer ctx.Close()
	if raw {
		if index < 0 || index >= len(ctx.Chapters) {
			return "", errors.New("chapter index is out of range")
		}
		return ctx.readText(ctx.Chapters[index].Path)
	}
	return ctx.ChapterHTML(index)
}

func (ctx *BookContext) ChapterHTML(index int) (string, error) {
	if index < 0 || index >= len(ctx.Chapters) {
		return "", errors.New("chapter index is out of range")
	}
	chapter := ctx.Chapters[index]
	data, err := ctx.readText(chapter.Path)
	if err != nil {
		return "", err
	}
	return rewriteHTMLAssetLinks(data, ctx.ID, posixDir(chapter.Path)), nil
}

func (s *Service) EditChapters(id string, req ChapterEditRequest) (BookAnalysis, error) {
	lock := s.getBookLock(id)
	lock.Lock()
	defer lock.Unlock()

	ctx, err := loadBook(id)
	if err != nil {
		return BookAnalysis{}, err
	}
	defer ctx.Close()

	newFileName, err := ctx.EditChapters(req.Action, req.Index, req.TargetIndex, req.NewTitle, req.Content, req.MergeIndices)
	if err != nil {
		return BookAnalysis{}, err
	}

	newID := toID(newFileName)
	newCtx, err := loadBook(newID)
	if err != nil {
		return BookAnalysis{}, err
	}
	defer newCtx.Close()

	return newCtx.Analysis(), nil
}

func (s *Service) CleanChapter(id string, req models.ChapterEditRequest) (string, error) {
	lock := s.getBookLock(id)
	lock.Lock()
	defer lock.Unlock()

	var htmlContent string
	if strings.TrimSpace(req.Content) != "" {
		htmlContent = req.Content
	} else {
		ctx, err := loadBook(id)
		if err != nil {
			return "", err
		}
		defer ctx.Close()

		if req.Index < 0 || req.Index >= len(ctx.Chapters) {
			return "", errors.New("invalid chapter index")
		}

		var errRead error
		htmlContent, errRead = ctx.readText(ctx.Chapters[req.Index].Path)
		if errRead != nil {
			return "", errRead
		}
	}

	cleaned := CleanHTMLContent(
		htmlContent,
		req.StripInlineStyles,
		req.RemoveEmptyLines,
		req.NormalizeParagraphs,
		req.RegexFilters,
		req.NormalizeTypography,
		req.SmartQuotes,
		req.NormalizeTones,
		req.FixSpacing,
	)
	return cleaned, nil
}

func CleanHTMLContent(htmlContent string, stripInline bool, removeEmpty bool, normalizeParas bool, regexFilters []string, normalizeTypography bool, smartQuotes bool, normalizeTones bool, fixSpacing bool) string {
	bodyStartMatch := regexp.MustCompile(`(?i)<body[^>]*>`).FindStringIndex(htmlContent)
	bodyEndMatch := regexp.MustCompile(`(?i)</body>`).FindStringIndex(htmlContent)

	var header, body, footer string
	if bodyStartMatch != nil && bodyEndMatch != nil {
		header = htmlContent[:bodyStartMatch[1]]
		body = htmlContent[bodyStartMatch[1]:bodyEndMatch[0]]
		footer = htmlContent[bodyEndMatch[0]:]
	} else {
		header = ""
		body = htmlContent
		footer = ""
	}

	if stripInline {
		body = regexp.MustCompile(`(?is)<style\b[^>]*>.*?</style>`).ReplaceAllString(body, "")
		body = regexp.MustCompile(`(?is)\s+style\s*=\s*(?:"[^"]*"|'[^']*')`).ReplaceAllString(body, "")
		body = regexp.MustCompile(`(?is)</?font\b[^>]*>`).ReplaceAllString(body, "")
		body = regexp.MustCompile(`(?is)</?span\b[^>]*>`).ReplaceAllString(body, "")
	}

	if removeEmpty {
		body = regexp.MustCompile(`(?is)<p\b[^>]*>\s*(?:&nbsp;|\s)*</p>`).ReplaceAllString(body, "")
	}

	if normalizeParas {
		body = regexp.MustCompile(`(?is)<p\b[^>]*>\s*(?:&nbsp;|\s)+`).ReplaceAllString(body, "<p>")
		body = regexp.MustCompile(`(?is)(?:<br\s*/?>\s*){2,}`).ReplaceAllString(body, "</p><p>")
	}

	for _, filter := range regexFilters {
		filter = strings.TrimSpace(filter)
		if filter == "" {
			continue
		}

		re, err := regexp.Compile("(?is)" + filter)
		if err == nil {
			body = re.ReplaceAllString(body, "")
		}
	}

	if normalizeTypography && (smartQuotes || normalizeTones || fixSpacing) {
		body = CleanHTMLContentTextNodes(body, smartQuotes, normalizeTones, fixSpacing)
	}

	return header + body + footer
}

type htmlSegment struct {
	text       string
	isTextNode bool
}

func CleanHTMLContentTextNodes(body string, smartQuotes bool, normalizeTones bool, fixSpacing bool) string {
	segments := tokenizeHTML(body)
	var result strings.Builder
	for _, seg := range segments {
		if seg.isTextNode {
			t := seg.text
			if smartQuotes {
				t = applySmartQuotes(t)
			}
			if normalizeTones {
				t = applyToneNormalization(t)
			}
			if fixSpacing {
				t = applySpacingNormalization(t)
			}
			result.WriteString(t)
		} else {
			result.WriteString(seg.text)
		}
	}
	return result.String()
}

func tokenizeHTML(htmlStr string) []htmlSegment {
	var segments []htmlSegment
	var current strings.Builder
	inTag := false
	activeBlockTag := ""

	runes := []rune(htmlStr)
	n := len(runes)
	for i := 0; i < n; i++ {
		r := runes[i]
		if inTag {
			current.WriteRune(r)
			if r == '>' {
				tagContent := current.String()
				segments = append(segments, htmlSegment{text: tagContent, isTextNode: false})
				current.Reset()
				inTag = false

				tagName := getTagName(tagContent)
				if strings.HasPrefix(tagName, "/") {
					closedTag := strings.TrimPrefix(tagName, "/")
					if closedTag == activeBlockTag {
						activeBlockTag = ""
					}
				} else if activeBlockTag == "" {
					if tagName == "script" || tagName == "style" || tagName == "pre" || tagName == "code" {
						activeBlockTag = tagName
					}
				}
			}
		} else {
			if r == '<' {
				if current.Len() > 0 {
					segments = append(segments, htmlSegment{
						text:       current.String(),
						isTextNode: activeBlockTag == "",
					})
					current.Reset()
				}
				inTag = true
				current.WriteRune(r)
			} else {
				current.WriteRune(r)
			}
		}
	}
	if current.Len() > 0 {
		segments = append(segments, htmlSegment{
			text:       current.String(),
			isTextNode: activeBlockTag == "",
		})
	}
	return segments
}

func getTagName(tagContent string) string {
	content := strings.TrimSuffix(strings.TrimPrefix(tagContent, "<"), ">")
	content = strings.TrimSpace(content)
	if content == "" {
		return ""
	}
	parts := strings.Fields(content)
	if len(parts) == 0 {
		return ""
	}
	return strings.ToLower(parts[0])
}

func applySmartQuotes(text string) string {
	runes := []rune(text)
	n := len(runes)
	var result strings.Builder

	isWhitespace := func(r rune) bool {
		return r == ' ' || r == '\t' || r == '\n' || r == '\r' || r == 160
	}

	isPunctuation := func(r rune) bool {
		return strings.ContainsRune(".,!?;:()[]{}<>-\"'/\\", r)
	}

	for i := 0; i < n; i++ {
		r := runes[i]
		if r == '"' {
			prevIsSpace := i == 0 || isWhitespace(runes[i-1]) || runes[i-1] == '(' || runes[i-1] == '[' || runes[i-1] == '{'
			nextIsSpace := i == n-1 || isWhitespace(runes[i+1]) || runes[i+1] == ')' || runes[i+1] == ']' || runes[i+1] == '}' || isPunctuation(runes[i+1])

			if prevIsSpace && !nextIsSpace {
				result.WriteRune('“')
			} else if !prevIsSpace && nextIsSpace {
				result.WriteRune('”')
			} else if prevIsSpace && nextIsSpace {
				result.WriteRune('“')
			} else {
				result.WriteRune('”')
			}
		} else if r == '\'' {
			prevIsSpace := i == 0 || isWhitespace(runes[i-1]) || runes[i-1] == '(' || runes[i-1] == '[' || runes[i-1] == '{'
			nextIsSpace := i == n-1 || isWhitespace(runes[i+1]) || runes[i+1] == ')' || runes[i+1] == ']' || runes[i+1] == '}' || isPunctuation(runes[i+1])

			isApostrophe := false
			if i > 0 && i < n-1 {
				prevChar := runes[i-1]
				nextChar := runes[i+1]
				if unicode.IsLetter(prevChar) && unicode.IsLetter(nextChar) {
					isApostrophe = true
				}
			}

			if isApostrophe {
				result.WriteRune('’')
			} else if prevIsSpace && !nextIsSpace {
				result.WriteRune('‘')
			} else if !prevIsSpace && nextIsSpace {
				result.WriteRune('’')
			} else {
				result.WriteRune('’')
			}
		} else {
			result.WriteRune(r)
		}
	}
	return result.String()
}

func applyToneNormalization(text string) string {
	text = strings.ReplaceAll(text, "qu", "__qu_lc__")
	text = strings.ReplaceAll(text, "Qu", "__qu_uc__")
	text = strings.ReplaceAll(text, "QU", "__qu_uu__")
	text = strings.ReplaceAll(text, "qU", "__qu_lu__")

	replacements := []struct{ old, new string }{
		{"oà", "òa"}, {"oá", "óa"}, {"oả", "ỏa"}, {"oã", "õa"}, {"oạ", "ọa"},
		{"Oà", "Òa"}, {"Oá", "Óa"}, {"Oả", "Ỏa"}, {"Oã", "Õa"}, {"Oạ", "Ọa"},
		{"oÀ", "òa"}, {"oÁ", "óa"}, {"oẢ", "ỏa"}, {"oÃ", "õa"}, {"oẠ", "ọa"},
		{"OÀ", "ÒA"}, {"OÁ", "ÓA"}, {"OẢ", "ỎA"}, {"OÃ", "ÕA"}, {"OẠ", "ỌA"},

		{"oè", "òe"}, {"oé", "óe"}, {"oẻ", "ỏe"}, {"oẽ", "õe"}, {"oẹ", "ọe"},
		{"Oè", "Òe"}, {"Oé", "Óe"}, {"Oẻ", "Ỏe"}, {"Oẽ", "Õe"}, {"Oẹ", "Ọe"},
		{"oÈ", "òe"}, {"oÉ", "óe"}, {"oẺ", "ỏe"}, {"oẼ", "õe"}, {"oẸ", "ọe"},
		{"OÈ", "ÒE"}, {"OÉ", "ÓE"}, {"OẺ", "ỎE"}, {"OẼ", "ÕE"}, {"OẸ", "ỌE"},

		{"uỳ", "ùy"}, {"uý", "úy"}, {"uỷ", "ủy"}, {"uỹ", "ũy"}, {"uỵ", "ụy"},
		{"Uỳ", "Ùy"}, {"Uý", "Úy"}, {"Uỷ", "Ủy"}, {"Uỹ", "Ũy"}, {"Uỵ", "Ụy"},
		{"uỲ", "ùy"}, {"uÝ", "úy"}, {"uỶ", "ủy"}, {"uỸ", "ũy"}, {"uỴ", "ụy"},
		{"UÝ", "ÚY"}, {"UỶ", "ỦY"}, {"UỸ", "ŨY"}, {"UỴ", "ỤY"},
	}

	for _, r := range replacements {
		text = strings.ReplaceAll(text, r.old, r.new)
	}

	text = strings.ReplaceAll(text, "__qu_lc__", "qu")
	text = strings.ReplaceAll(text, "__qu_uc__", "Qu")
	text = strings.ReplaceAll(text, "__qu_uu__", "QU")
	text = strings.ReplaceAll(text, "__qu_lu__", "qU")

	return text
}

func applySpacingNormalization(text string) string {
	runes := []rune(text)
	n := len(runes)
	var result []rune

	isSpace := func(r rune) bool {
		return r == ' ' || r == '\t' || r == 160
	}

	isPunct := func(r rune) bool {
		return r == '.' || r == ',' || r == ';' || r == ':' || r == '!' || r == '?'
	}

	for i := 0; i < n; i++ {
		r := runes[i]

		if isSpace(r) {
			nextIdx := i
			for nextIdx < n && isSpace(runes[nextIdx]) {
				nextIdx++
			}
			if nextIdx < n && isPunct(runes[nextIdx]) {
				continue
			}

			result = append(result, ' ')
			for i+1 < n && isSpace(runes[i+1]) {
				i++
			}
			continue
		}

		result = append(result, r)

		if isPunct(r) {
			isEllipsis := false
			if r == '.' {
				dotCount := 1
				idxBefore := len(result) - 2
				for idxBefore >= 0 && result[idxBefore] == '.' {
					dotCount++
					idxBefore--
				}
				idxAfter := i + 1
				for idxAfter < n && runes[idxAfter] == '.' {
					dotCount++
					idxAfter++
				}
				if dotCount >= 3 {
					isEllipsis = true
				}
			}

			if isEllipsis {
				continue
			}

			if i+1 < n {
				nextRune := runes[i+1]
				if isSpace(nextRune) {
					continue
				}
				if unicode.IsDigit(nextRune) {
					continue
				}
				if strings.ContainsRune(".,!?;:()[]{}<>\"'“”‘’)»]", nextRune) {
					continue
				}
				result = append(result, ' ')
			}
		}
	}

	return string(result)
}

func (ctx *BookContext) EditChapters(action string, index int, targetIndex int, newTitle string, content string, mergeIndices []int) (string, error) {
	if index < 0 || index >= len(ctx.Chapters) {
		return "", errors.New("invalid chapter index")
	}

	opfXML := ctx.OPFXML

	var ncxXML string
	var ncxPath string
	if ctx.NCX != nil {
		ncxPath = ctx.NCX.FullPath
		var err error
		ncxXML, err = ctx.readText(ncxPath)
		if err != nil {
			ncxXML = ""
		}
	}

	var navPath string
	var navHTML string
	for _, item := range ctx.Manifest {
		if strings.Contains(strings.ToLower(item.MediaType), "properties") && strings.Contains(strings.ToLower(item.Attrs["properties"]), "nav") {
			navPath = item.FullPath
			var err error
			navHTML, err = ctx.readText(navPath)
			if err != nil {
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
				var err error
				navHTML, err = ctx.readText(navPath)
				if err != nil {
					navPath = ""
				}
				break
			}
		}
	}

	editedFiles := map[string][]byte{}

	switch action {
	case "save_content":
		ch := ctx.Chapters[index]
		editedFiles[ch.Path] = []byte(content)

	case "rename":
		if ncxXML != "" {
			ncxXML = editNCXTitle(ncxXML, ctx.Chapters, index, newTitle)
			editedFiles[ncxPath] = []byte(ncxXML)
		}

		if navPath != "" {
			navHTML = editNavTitle(navHTML, ctx.Chapters, index, newTitle)
			editedFiles[navPath] = []byte(navHTML)
		}

	case "reorder":
		if index < 0 || index >= len(ctx.Chapters) || targetIndex < 0 || targetIndex > len(ctx.Chapters) {
			return "", fmt.Errorf("chỉ mục chương không hợp lệ: %d -> %d", index, targetIndex)
		}
		newChapters, insertIndex := reorderedChapters(ctx.Chapters, index, targetIndex)
		if insertIndex == index {
			break
		}

		var ok bool
		opfXML, ok = reorderOPFSpine(opfXML, ctx.Chapters, newChapters)
		if !ok {
			return "", fmt.Errorf("không thể sắp xếp lại spine trong file opf")
		}
		editedFiles[ctx.OPFPath] = []byte(opfXML)

		if ncxXML != "" {
			ncxXML = reorderNCXPointsByChapters(ncxXML, ctx.Chapters, newChapters, posixDir(ncxPath))
			editedFiles[ncxPath] = []byte(ncxXML)
		}

		if navPath != "" {
			navHTML = reorderNavLIsByChapters(navHTML, ctx.Chapters, newChapters, posixDir(navPath))
			editedFiles[navPath] = []byte(navHTML)
		}
	case "add":

		chapterTitle := "Chương mới"
		if newTitle != "" {
			chapterTitle = newTitle
		}

		dir := path.Dir(ctx.Chapters[index].Path)
		ext := ".html"

		var newRelPath string
		var newFullPath string
		var newID string
		for k := 1; ; k++ {
			newFileName := fmt.Sprintf("chapter_new_%d%s", k, ext)
			newFullPath = path.Join(dir, newFileName)
			newRelPath = strings.TrimPrefix(newFullPath, ctx.OPFDir)
			newID = fmt.Sprintf("chapter_new_%d", k)

			exists := false
			for _, item := range ctx.Manifest {
				if item.FullPath == newFullPath || item.ID == newID {
					exists = true
					break
				}
			}
			if !exists {
				break
			}
		}

		var headContent string
		adjHTML, err := ctx.readText(ctx.Chapters[index].Path)
		if err == nil {
			headStart := strings.Index(strings.ToLower(adjHTML), "<head>")
			headEnd := strings.Index(strings.ToLower(adjHTML), "</head>")
			if headStart != -1 && headEnd != -1 {
				headContent = adjHTML[headStart+6 : headEnd]
			}
		}
		if headContent == "" {
			headContent = `
<title>Chương mới</title>
<meta http-equiv="Content-Type" content="text/html; charset=utf-8"/>
<link rel="stylesheet" type="text/css" href="stylesheet.css"/>
<link rel="stylesheet" type="text/css" href="page_styles.css"/>
`
		} else {
			reTitle := regexp.MustCompile(`(?is)<title[^>]*>.*?</title>`)
			if reTitle.MatchString(headContent) {
				headContent = reTitle.ReplaceAllString(headContent, "<title>Chương mới</title>")
			} else {
				headContent = "<title>Chương mới</title>\n" + headContent
			}
		}

		newContent := fmt.Sprintf(`<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<head>%s</head>
<body>
<h2>%s</h2>
<p>Nhập nội dung chương ở đây...</p>
</body>
</html>`, headContent, chapterTitle)

		editedFiles[newFullPath] = []byte(newContent)

		manifestItem := fmt.Sprintf(`    <item id="%s" href="%s" media-type="application/xhtml+xml" />`, newID, newRelPath)
		manifestMatch := manifestRe.FindStringSubmatch(opfXML)
		if len(manifestMatch) >= 3 {
			insertIdx := strings.Index(opfXML, manifestMatch[2]) + len(manifestMatch[2])
			opfXML = opfXML[:insertIdx] + "\n" + manifestItem + opfXML[insertIdx:]
		}

		ch := ctx.Chapters[index]
		escapedID := regexp.QuoteMeta(ch.IDRef)
		refRe := regexp.MustCompile(`(?is)<itemref\b[^>]*\bidref\s*=\s*["']` + escapedID + `["'][^>]*>`)
		refMatch := refRe.FindStringIndex(opfXML)
		if refMatch != nil {
			insertIdx := refMatch[1]
			spineRef := fmt.Sprintf("\n    <itemref idref=\"%s\" />", newID)
			opfXML = opfXML[:insertIdx] + spineRef + opfXML[insertIdx:]
		}
		editedFiles[ctx.OPFPath] = []byte(opfXML)

		if ncxXML != "" {
			ncxXML = insertNCXPointAfter(ncxXML, ctx.Chapters, index, chapterTitle, newRelPath, newID)
			editedFiles[ncxPath] = []byte(ncxXML)
		}

		if navPath != "" {
			navHTML = insertNavLIAfter(navHTML, ctx.Chapters, index, chapterTitle, newRelPath)
			editedFiles[navPath] = []byte(navHTML)
		}

	case "delete_multiple":
		deletions := make([]int, len(mergeIndices))
		copy(deletions, mergeIndices)
		for i := 0; i < len(deletions)-1; i++ {
			for j := i + 1; j < len(deletions); j++ {
				if deletions[i] < deletions[j] {
					deletions[i], deletions[j] = deletions[j], deletions[i]
				}
			}
		}

		for _, idx := range deletions {
			if idx < 0 || idx >= len(ctx.Chapters) {
				continue
			}
			ch := ctx.Chapters[idx]
			opfXML = removeSpineItem(opfXML, ch.IDRef)

			if ncxXML != "" {
				ncxXML = deleteNCXPoint(ncxXML, ctx.Chapters, idx)
			}

			if navPath != "" {
				navHTML = deleteNavLI(navHTML, ctx.Chapters, idx)
			}
		}
		editedFiles[ctx.OPFPath] = []byte(opfXML)
		if ncxXML != "" {
			editedFiles[ncxPath] = []byte(ncxXML)
		}
		if navPath != "" {
			editedFiles[navPath] = []byte(navHTML)
		}

	case "delete":
		ch := ctx.Chapters[index]

		opfXML = removeSpineItem(opfXML, ch.IDRef)
		editedFiles[ctx.OPFPath] = []byte(opfXML)

		if ncxXML != "" {
			ncxXML = deleteNCXPoint(ncxXML, ctx.Chapters, index)
			editedFiles[ncxPath] = []byte(ncxXML)
		}

		if navPath != "" {
			navHTML = deleteNavLI(navHTML, ctx.Chapters, index)
			editedFiles[navPath] = []byte(navHTML)
		}

	case "merge":
		var chAIdx int
		var secondaryIndices []int
		var mergedTitle string

		if len(mergeIndices) > 1 {

			for _, idx := range mergeIndices {
				if idx < 0 || idx >= len(ctx.Chapters) {
					return "", fmt.Errorf("chỉ mục chương %d không hợp lệ", idx)
				}
			}

			chAIdx = mergeIndices[0]
			secondaryIndices = mergeIndices[1:]

			if newTitle != "" {
				mergedTitle = newTitle
			} else {

				titles := []string{}
				for _, idx := range mergeIndices {
					titles = append(titles, ctx.Chapters[idx].Title)
				}
				mergedTitle = strings.Join(titles, " & ")
			}
		} else {

			chAIdx = index
			var chBIdx int
			if targetIndex >= 0 && targetIndex < len(ctx.Chapters) {
				chBIdx = targetIndex
			} else {
				if index >= len(ctx.Chapters)-1 {
					return "", errors.New("không thể gộp chương cuối với chương tiếp theo")
				}
				chBIdx = index + 1
			}

			if chAIdx == chBIdx {
				return "", errors.New("không thể gộp một chương với chính nó")
			}

			if chAIdx > chBIdx {
				chAIdx, chBIdx = chBIdx, chAIdx
			}
			secondaryIndices = []int{chBIdx}

			chA := ctx.Chapters[chAIdx]
			chB := ctx.Chapters[chBIdx]

			mergedTitle = newTitle
			if mergedTitle == "" {
				mergedTitle = chA.Title
				if !strings.HasPrefix(strings.ToLower(chB.Title), "unknown") {
					mergedTitle = chA.Title + " & " + chB.Title
				}
			}
		}

		chA := ctx.Chapters[chAIdx]

		var currentHTML string
		if len(mergeIndices) > 1 {
			var err error
			currentHTML, err = ctx.readText(ctx.Chapters[mergeIndices[0]].Path)
			if err != nil {
				return "", fmt.Errorf("không thể đọc chương %d: %w", mergeIndices[0], err)
			}
			for i := 1; i < len(mergeIndices); i++ {
				nextIdx := mergeIndices[i]
				htmlNext, err := ctx.readText(ctx.Chapters[nextIdx].Path)
				if err != nil {
					return "", fmt.Errorf("không thể đọc chương %d: %w", nextIdx, err)
				}
				currentHTML = mergeHTML(currentHTML, htmlNext)
			}
		} else {
			chBIdx := secondaryIndices[0]
			chB := ctx.Chapters[chBIdx]
			htmlA, err := ctx.readText(chA.Path)
			if err != nil {
				return "", fmt.Errorf("không thể đọc chương A: %w", err)
			}
			htmlB, err := ctx.readText(chB.Path)
			if err != nil {
				return "", fmt.Errorf("không thể đọc chương B: %w", err)
			}
			currentHTML = mergeHTML(htmlA, htmlB)
		}

		editedFiles[chA.Path] = []byte(currentHTML)

		for _, idx := range secondaryIndices {
			ch := ctx.Chapters[idx]
			opfXML = removeSpineItem(opfXML, ch.IDRef)
		}
		editedFiles[ctx.OPFPath] = []byte(opfXML)

		deletions := make([]int, len(secondaryIndices))
		copy(deletions, secondaryIndices)

		for i := 0; i < len(deletions)-1; i++ {
			for j := i + 1; j < len(deletions); j++ {
				if deletions[i] < deletions[j] {
					deletions[i], deletions[j] = deletions[j], deletions[i]
				}
			}
		}

		if ncxXML != "" {
			for _, idx := range deletions {
				ncxXML = deleteNCXPoint(ncxXML, ctx.Chapters, idx)
			}
			ncxXML = editNCXTitle(ncxXML, ctx.Chapters, chAIdx, mergedTitle)
			editedFiles[ncxPath] = []byte(ncxXML)
		}

		if navPath != "" {
			for _, idx := range deletions {
				navHTML = deleteNavLI(navHTML, ctx.Chapters, idx)
			}
			navHTML = editNavTitle(navHTML, ctx.Chapters, chAIdx, mergedTitle)
			editedFiles[navPath] = []byte(navHTML)
		}

	case "split":
		ch := ctx.Chapters[index]
		htmlContent, err := ctx.readText(ch.Path)
		if err != nil {
			return "", err
		}

		re := regexp.MustCompile(`(?i)<h[1-3][^>]*>`)
		matches := re.FindAllStringIndex(htmlContent, -1)
		if len(matches) < 2 {
			return "", errors.New("không tìm thấy đủ tiêu đề (H1, H2, H3) trong chương này để tự động tách")
		}

		var parts []string
		var headers []string
		lastIdx := 0
		for i, match := range matches {
			start := match[0]
			headerTitle := fmt.Sprintf("%s (Phần %d)", ch.Title, i+1)
			headerRe := regexp.MustCompile(`(?i)</h[1-3]>`)
			endMatch := headerRe.FindStringIndex(htmlContent[start:])
			if endMatch != nil {
				headerHTML := htmlContent[start : start+endMatch[1]]
				headerTitle = stripHTMLTags(headerHTML)
				if strings.TrimSpace(headerTitle) == "" {
					headerTitle = fmt.Sprintf("%s (Phần %d)", ch.Title, i+1)
				}
			}
			headers = append(headers, headerTitle)

			if i > 0 {
				parts = append(parts, htmlContent[lastIdx:start])
			} else {
				parts = append(parts, htmlContent[lastIdx:start])
			}
			lastIdx = start
		}
		parts = append(parts, htmlContent[lastIdx:])

		if len(parts) < 2 {
			return "", errors.New("không thể tách chương")
		}

		preamble := parts[0]
		bodyStart := strings.Index(strings.ToLower(preamble), "<body")
		var headPreamble string
		if bodyStart != -1 {
			bodyHeaderClose := strings.Index(preamble[bodyStart:], ">")
			if bodyHeaderClose != -1 {
				headPreamble = preamble[:bodyStart+bodyHeaderClose+1]
			} else {
				headPreamble = preamble
			}
		} else {
			headPreamble = "<?xml version=\"1.0\" encoding=\"utf-8\"?>\n<!DOCTYPE html PUBLIC \"-//W3C//DTD XHTML 1.1//EN\" \"http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd\">\n<html xmlns=\"http://www.w3.org/1999/xhtml\">\n<head>\n<title>Split</title>\n</head>\n<body>"
		}
		postamble := "</body>\n</html>"

		firstPartContent := headPreamble + "\n" + parts[1]
		if !strings.Contains(strings.ToLower(firstPartContent), "</body>") {
			firstPartContent += postamble
		}
		editedFiles[ch.Path] = []byte(firstPartContent)

		dir := path.Dir(ch.Path)
		ext := path.Ext(ch.Path)
		base := strings.TrimSuffix(path.Base(ch.Path), ext)

		var newManifestItems []string
		var newSpineRefs []string
		var splitTitles []string
		var splitHrefs []string

		for i := 2; i < len(parts); i++ {
			splitContent := headPreamble + "\n" + parts[i]
			if !strings.Contains(strings.ToLower(splitContent), "</body>") {
				splitContent += postamble
			}

			newFileName := fmt.Sprintf("%s_split_%d%s", base, i, ext)
			newFullPath := path.Join(dir, newFileName)
			newRelPath := strings.TrimPrefix(newFullPath, ctx.OPFDir)
			newID := fmt.Sprintf("%s_split_%d", ch.IDRef, i)

			editedFiles[newFullPath] = []byte(splitContent)

			newManifestItems = append(newManifestItems, fmt.Sprintf(`    <item id="%s" href="%s" media-type="application/xhtml+xml" />`, newID, newRelPath))
			newSpineRefs = append(newSpineRefs, fmt.Sprintf(`    <itemref idref="%s" />`, newID))
			splitTitles = append(splitTitles, headers[i-1])
			splitHrefs = append(splitHrefs, newRelPath)
		}

		manifestMatch := manifestRe.FindStringSubmatch(opfXML)
		if len(manifestMatch) >= 3 {
			insertIdx := strings.Index(opfXML, manifestMatch[2]) + len(manifestMatch[2])
			opfXML = opfXML[:insertIdx] + "\n" + strings.Join(newManifestItems, "\n") + opfXML[insertIdx:]
		}

		escapedID := regexp.QuoteMeta(ch.IDRef)
		refRe := regexp.MustCompile(`(?is)<itemref\b[^>]*\bidref\s*=\s*["']` + escapedID + `["'][^>]*>`)
		refMatch := refRe.FindStringIndex(opfXML)
		if refMatch != nil {
			insertIdx := refMatch[1]
			opfXML = opfXML[:insertIdx] + "\n" + strings.Join(newSpineRefs, "\n") + opfXML[insertIdx:]
		}
		editedFiles[ctx.OPFPath] = []byte(opfXML)

		firstPartTitle := headers[0]
		if ncxXML != "" {
			ncxXML = editNCXTitle(ncxXML, ctx.Chapters, index, firstPartTitle)
			ncxXML = splitNCXPoint(ncxXML, ctx.Chapters, index, splitTitles, splitHrefs)
			editedFiles[ncxPath] = []byte(ncxXML)
		}

		if navPath != "" {
			navHTML = editNavTitle(navHTML, ctx.Chapters, index, firstPartTitle)
			navHTML = splitNavLI(navHTML, ctx.Chapters, index, splitTitles, splitHrefs)
			editedFiles[navPath] = []byte(navHTML)
		}
	}

	if ncxXML != "" && editedFiles[ncxPath] != nil {
		ncxXML = renumberPlayOrder(ncxXML)
		editedFiles[ncxPath] = []byte(ncxXML)
	}

	newFileName, err := ctx.writeEditedEPUB(editedFiles)
	if err != nil {
		return "", fmt.Errorf("không thể cập nhật tệp sách EPUB: %w", err)
	}

	return newFileName, nil
}

func (ctx *BookContext) writeEditedEPUB(editedFiles map[string][]byte) (string, error) {
	newPath := ctx.FilePath

	var targetPath string
	isSame := newPath == ctx.FilePath
	if isSame {
		targetPath = newPath + ".tmp"
	} else {
		targetPath = newPath
	}

	out, err := os.Create(targetPath)
	if err != nil {
		return "", err
	}
	zw := zip.NewWriter(out)

	for _, f := range ctx.Reader.File {
		if content, ok := editedFiles[f.Name]; ok {
			w, err := zw.CreateHeader(&zip.FileHeader{
				Name:   f.Name,
				Method: zip.Deflate,
			})
			if err != nil {
				_ = zw.Close()
				_ = out.Close()
				_ = os.Remove(targetPath)
				return "", err
			}
			if _, err := w.Write(content); err != nil {
				_ = zw.Close()
				_ = out.Close()
				_ = os.Remove(targetPath)
				return "", err
			}
		} else {
			rc, err := f.Open()
			if err != nil {
				_ = zw.Close()
				_ = out.Close()
				_ = os.Remove(targetPath)
				return "", err
			}
			w, err := zw.CreateHeader(&zip.FileHeader{
				Name:   f.Name,
				Method: f.Method,
			})
			if err != nil {
				_ = rc.Close()
				_ = zw.Close()
				_ = out.Close()
				_ = os.Remove(targetPath)
				return "", err
			}
			_, err = io.Copy(w, rc)
			_ = rc.Close()
			if err != nil {
				_ = zw.Close()
				_ = out.Close()
				_ = os.Remove(targetPath)
				return "", err
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
			w, err := zw.CreateHeader(&zip.FileHeader{
				Name:   path,
				Method: zip.Deflate,
			})
			if err != nil {
				_ = zw.Close()
				_ = out.Close()
				_ = os.Remove(targetPath)
				return "", err
			}
			if _, err := w.Write(content); err != nil {
				_ = zw.Close()
				_ = out.Close()
				_ = os.Remove(targetPath)
				return "", err
			}
		}
	}

	if err := zw.Close(); err != nil {
		_ = out.Close()
		_ = os.Remove(targetPath)
		return "", err
	}
	if err := out.Close(); err != nil {
		_ = os.Remove(targetPath)
		return "", err
	}

	if isSame {
		_ = ctx.Reader.Close()
		ctx.Reader = nil

		if err := os.Rename(targetPath, newPath); err != nil {
			return "", err
		}
	}

	return filepath.Base(newPath), nil
}

func replaceNCXTitle(ncxXML, src, newTitle string) string {
	escapedSrc := regexp.QuoteMeta(src)
	re := regexp.MustCompile(`(?is)(<navLabel\b[^>]*>\s*<text\b[^>]*>)(.*?)(</text>\s*</navLabel>\s*<content\s+src=["']` + escapedSrc + `["'])`)
	if re.MatchString(ncxXML) {
		return re.ReplaceAllString(ncxXML, `${1}`+newTitle+`${3}`)
	}

	reReverse := regexp.MustCompile(`(?is)(<content\s+src=["']` + escapedSrc + `["'][^>]*>\s*<navLabel\b[^>]*>\s*<text\b[^>]*>)(.*?)(</text>)`)
	if reReverse.MatchString(ncxXML) {
		return reReverse.ReplaceAllString(ncxXML, `${1}`+newTitle+`${3}`)
	}

	return ncxXML
}

func replaceNavTitle(navHTML, src, newTitle string) string {
	escapedSrc := regexp.QuoteMeta(src)
	re := regexp.MustCompile(`(?is)(<a\b[^>]*\bhref\s*=\s*["']` + escapedSrc + `["'][^>]*>)(.*?)(</a>)`)
	return re.ReplaceAllString(navHTML, `${1}`+newTitle+`${3}`)
}

func removeSpineItem(opfXML, id string) string {
	escapedID := regexp.QuoteMeta(id)
	re := regexp.MustCompile(`(?is)<itemref\b[^>]*\bidref\s*=\s*["']` + escapedID + `["'][^>]*>`)
	return re.ReplaceAllString(opfXML, "")
}

func removeNCXPoint(ncxXML, src string) string {
	lowerNCX := strings.ToLower(ncxXML)
	targetStr := `src="` + src + `"`
	contentIdx := strings.Index(lowerNCX, strings.ToLower(targetStr))
	if contentIdx == -1 {
		targetStr = `src='` + src + `'`
		contentIdx = strings.Index(lowerNCX, strings.ToLower(targetStr))
	}
	if contentIdx == -1 {
		return ncxXML
	}

	navPointStart := strings.LastIndex(lowerNCX[:contentIdx], "<navpoint")
	if navPointStart == -1 {
		return ncxXML
	}

	endIdx := findMatchingClosingTag(ncxXML, navPointStart, "<navpoint", "</navpoint>")
	if endIdx == -1 {
		return ncxXML
	}

	return ncxXML[:navPointStart] + ncxXML[endIdx:]
}

func removeNavLI(navHTML, src string) string {
	lowerNav := strings.ToLower(navHTML)
	targetStr := `href="` + src + `"`
	hrefIdx := strings.Index(lowerNav, strings.ToLower(targetStr))
	if hrefIdx == -1 {
		targetStr = `href='` + src + `'`
		hrefIdx = strings.Index(lowerNav, strings.ToLower(targetStr))
	}
	if hrefIdx == -1 {
		return navHTML
	}

	liStart := strings.LastIndex(lowerNav[:hrefIdx], "<li")
	if liStart == -1 {
		return navHTML
	}

	endIdx := findMatchingClosingTag(navHTML, liStart, "<li", "</li>")
	if endIdx == -1 {
		return navHTML
	}

	return navHTML[:liStart] + navHTML[endIdx:]
}

func findNCXHrefMatch(text, href, fullPath string) string {
	if strings.Contains(text, href) {
		return href
	}
	base := path.Base(fullPath)
	if strings.Contains(text, base) {
		return base
	}
	if strings.Contains(text, fullPath) {
		return fullPath
	}
	return href
}

func mergeHTML(htmlA, htmlB string) string {
	bodyBStart := strings.Index(strings.ToLower(htmlB), "<body")
	if bodyBStart == -1 {
		return htmlA
	}
	bodyBEnd := strings.Index(strings.ToLower(htmlB), "</body>")
	if bodyBEnd == -1 {
		return htmlA
	}
	bodyBHeaderClose := strings.Index(htmlB[bodyBStart:], ">")
	if bodyBHeaderClose == -1 {
		return htmlA
	}
	innerB := htmlB[bodyBStart+bodyBHeaderClose+1 : bodyBEnd]

	bodyAEnd := strings.Index(strings.ToLower(htmlA), "</body>")
	if bodyAEnd == -1 {
		return htmlA + "\n" + innerB
	}

	return htmlA[:bodyAEnd] + "\n" + innerB + "\n" + htmlA[bodyAEnd:]
}

func stripHTMLTags(s string) string {
	re := regexp.MustCompile(`<[^>]*>`)
	return html.UnescapeString(re.ReplaceAllString(s, ""))
}

func reorderedChapters(chapters []models.Chapter, source, targetInsertion int) ([]models.Chapter, int) {
	next := make([]models.Chapter, 0, len(chapters))
	moved := chapters[source]
	next = append(next, chapters[:source]...)
	next = append(next, chapters[source+1:]...)

	insertIndex := targetInsertion
	if source < insertIndex {
		insertIndex--
	}
	if insertIndex < 0 {
		insertIndex = 0
	}
	if insertIndex > len(next) {
		insertIndex = len(next)
	}

	next = append(next[:insertIndex], append([]models.Chapter{moved}, next[insertIndex:]...)...)
	for idx := range next {
		next[idx].Index = idx
	}
	return next, insertIndex
}

func reorderOPFSpine(opfXML string, oldChapters, newChapters []models.Chapter) (string, bool) {
	spineMatch := spineRe.FindStringSubmatch(opfXML)
	if len(spineMatch) < 4 {
		return opfXML, false
	}

	itemrefs := itemrefRe.FindAllString(spineMatch[2], -1)
	if len(itemrefs) == 0 {
		return opfXML, false
	}

	chapterIDs := make(map[string]bool, len(oldChapters))
	refByID := make(map[string]string, len(oldChapters))
	for _, ch := range oldChapters {
		chapterIDs[ch.IDRef] = true
	}
	for _, rawRef := range itemrefs {
		idref := parseAttrs(rawRef)["idref"]
		if chapterIDs[idref] {
			refByID[idref] = rawRef
		}
	}

	orderedRefs := make([]string, 0, len(newChapters))
	for _, ch := range newChapters {
		rawRef := refByID[ch.IDRef]
		if rawRef == "" {
			return opfXML, false
		}
		orderedRefs = append(orderedRefs, rawRef)
	}

	nextChapterRef := 0
	for idx, rawRef := range itemrefs {
		idref := parseAttrs(rawRef)["idref"]
		if chapterIDs[idref] {
			itemrefs[idx] = orderedRefs[nextChapterRef]
			nextChapterRef++
		}
	}

	var newSpineBody strings.Builder
	newSpineBody.WriteString("\n")
	for _, ref := range itemrefs {
		newSpineBody.WriteString("    ")
		newSpineBody.WriteString(ref)
		newSpineBody.WriteString("\n")
	}
	newSpineBody.WriteString("  ")

	return spineRe.ReplaceAllString(opfXML, spineMatch[1]+newSpineBody.String()+spineMatch[3]), true
}

func getSpineOccurrenceCount(chapters []models.Chapter, targetIndex int) int {
	targetHref := path.Clean(chapters[targetIndex].Href)
	k := 0
	for i := 0; i < targetIndex; i++ {
		href := path.Clean(chapters[i].Href)
		if href == targetHref {
			k++
		}
	}
	return k
}

func findKthNCXMatch(ncxXML, targetHref string, k int) int {
	lowerNCX := strings.ToLower(ncxXML)
	variants := []string{
		`src="` + targetHref + `"`,
		`src='` + targetHref + `'`,
	}
	base := path.Base(targetHref)
	if base != targetHref {
		variants = append(variants, `src="`+base+`"`, `src='`+base+`'`)
	}

	var matches []int
	for _, variant := range variants {
		vLower := strings.ToLower(variant)
		pos := 0
		for {
			idx := strings.Index(lowerNCX[pos:], vLower)
			if idx == -1 {
				break
			}
			actualIdx := pos + idx
			matches = append(matches, actualIdx)
			pos = actualIdx + len(vLower)
		}
		if len(matches) > 0 {
			break
		}
	}

	if k >= 0 && k < len(matches) {
		return matches[k]
	}
	if len(matches) > 0 {
		return matches[0]
	}
	return -1
}

func editNCXTitle(ncxXML string, chapters []models.Chapter, targetIndex int, newTitle string) string {
	ch := chapters[targetIndex]
	k := getSpineOccurrenceCount(chapters, targetIndex)
	contentIdx := findKthNCXMatch(ncxXML, ch.Href, k)
	if contentIdx == -1 {
		return replaceNCXTitle(ncxXML, findNCXHrefMatch(ncxXML, ch.Href, ch.Path), newTitle)
	}

	navPointStart := strings.LastIndex(strings.ToLower(ncxXML[:contentIdx]), "<navpoint")
	if navPointStart == -1 {
		return ncxXML
	}

	endIdx := findMatchingClosingTag(ncxXML, navPointStart, "<navpoint", "</navpoint>")
	if endIdx == -1 {
		return ncxXML
	}

	block := ncxXML[navPointStart:endIdx]
	re := regexp.MustCompile(`(?is)(<navLabel\b[^>]*>\s*<text\b[^>]*>)(.*?)(</text>\s*</navLabel>)`)
	if re.MatchString(block) {
		newBlock := re.ReplaceAllString(block, `${1}`+newTitle+`${3}`)
		return ncxXML[:navPointStart] + newBlock + ncxXML[endIdx:]
	}

	return ncxXML
}

func deleteNCXPoint(ncxXML string, chapters []models.Chapter, targetIndex int) string {
	ch := chapters[targetIndex]
	k := getSpineOccurrenceCount(chapters, targetIndex)
	contentIdx := findKthNCXMatch(ncxXML, ch.Href, k)
	if contentIdx == -1 {
		return removeNCXPoint(ncxXML, findNCXHrefMatch(ncxXML, ch.Href, ch.Path))
	}

	navPointStart := strings.LastIndex(strings.ToLower(ncxXML[:contentIdx]), "<navpoint")
	if navPointStart == -1 {
		return ncxXML
	}

	endIdx := findMatchingClosingTag(ncxXML, navPointStart, "<navpoint", "</navpoint>")
	if endIdx == -1 {
		return ncxXML
	}

	return ncxXML[:navPointStart] + ncxXML[endIdx:]
}

func splitNCXPoint(ncxXML string, chapters []models.Chapter, targetIndex int, splitTitles []string, splitHrefs []string) string {
	ch := chapters[targetIndex]
	k := getSpineOccurrenceCount(chapters, targetIndex)
	contentIdx := findKthNCXMatch(ncxXML, ch.Href, k)
	if contentIdx == -1 {
		return ncxXML
	}

	navPointStart := strings.LastIndex(strings.ToLower(ncxXML[:contentIdx]), "<navpoint")
	if navPointStart == -1 {
		return ncxXML
	}

	endIdx := findMatchingClosingTag(ncxXML, navPointStart, "<navpoint", "</navpoint>")
	if endIdx == -1 {
		return ncxXML
	}

	var newNavPoints []string
	baseID := ch.IDRef
	if baseID == "" {
		baseID = "split_" + strconv.Itoa(targetIndex)
	}

	for i := 0; i < len(splitTitles); i++ {
		newID := fmt.Sprintf("%s_split_%d", baseID, i+2)
		np := fmt.Sprintf(`    <navPoint id="%s" playOrder="">
      <navLabel>
        <text>%s</text>
      </navLabel>
      <content src="%s"/>
    </navPoint>`, newID, splitTitles[i], splitHrefs[i])
		newNavPoints = append(newNavPoints, np)
	}

	insertStr := "\n" + strings.Join(newNavPoints, "\n")
	return ncxXML[:endIdx] + insertStr + ncxXML[endIdx:]
}

func findKthNavMatch(navHTML, targetHref string, k int) int {
	lowerNav := strings.ToLower(navHTML)
	variants := []string{
		`href="` + targetHref + `"`,
		`href='` + targetHref + `'`,
	}
	base := path.Base(targetHref)
	if base != targetHref {
		variants = append(variants, `href="`+base+`"`, `href='`+base+`'`)
	}

	var matches []int
	for _, variant := range variants {
		vLower := strings.ToLower(variant)
		pos := 0
		for {
			idx := strings.Index(lowerNav[pos:], vLower)
			if idx == -1 {
				break
			}
			actualIdx := pos + idx
			matches = append(matches, actualIdx)
			pos = actualIdx + len(vLower)
		}
		if len(matches) > 0 {
			break
		}
	}

	if k >= 0 && k < len(matches) {
		return matches[k]
	}
	if len(matches) > 0 {
		return matches[0]
	}
	return -1
}

func editNavTitle(navHTML string, chapters []models.Chapter, targetIndex int, newTitle string) string {
	ch := chapters[targetIndex]
	k := getSpineOccurrenceCount(chapters, targetIndex)
	hrefIdx := findKthNavMatch(navHTML, ch.Href, k)
	if hrefIdx == -1 {
		return replaceNavTitle(navHTML, findNCXHrefMatch(navHTML, ch.Href, ch.Path), newTitle)
	}

	aStart := strings.LastIndex(strings.ToLower(navHTML[:hrefIdx]), "<a")
	if aStart == -1 {
		return navHTML
	}

	aEnd := findMatchingClosingTag(navHTML, aStart, "<a", "</a>")
	if aEnd == -1 {
		return navHTML
	}

	block := navHTML[aStart:aEnd]
	re := regexp.MustCompile(`(?is)(<a\b[^>]*>)(.*?)(</a>)`)
	if re.MatchString(block) {
		newBlock := re.ReplaceAllString(block, `${1}`+newTitle+`${3}`)
		return navHTML[:aStart] + newBlock + navHTML[aEnd:]
	}

	return navHTML
}

func deleteNavLI(navHTML string, chapters []models.Chapter, targetIndex int) string {
	ch := chapters[targetIndex]
	k := getSpineOccurrenceCount(chapters, targetIndex)
	hrefIdx := findKthNavMatch(navHTML, ch.Href, k)
	if hrefIdx == -1 {
		return removeNavLI(navHTML, findNCXHrefMatch(navHTML, ch.Href, ch.Path))
	}

	liStart := strings.LastIndex(strings.ToLower(navHTML[:hrefIdx]), "<li")
	if liStart == -1 {
		return navHTML
	}

	endIdx := findMatchingClosingTag(navHTML, liStart, "<li", "</li>")
	if endIdx == -1 {
		return navHTML
	}

	return navHTML[:liStart] + navHTML[endIdx:]
}

func splitNavLI(navHTML string, chapters []models.Chapter, targetIndex int, splitTitles []string, splitHrefs []string) string {
	ch := chapters[targetIndex]
	k := getSpineOccurrenceCount(chapters, targetIndex)
	hrefIdx := findKthNavMatch(navHTML, ch.Href, k)
	if hrefIdx == -1 {
		return navHTML
	}

	liStart := strings.LastIndex(strings.ToLower(navHTML[:hrefIdx]), "<li")
	if liStart == -1 {
		return navHTML
	}

	endIdx := findMatchingClosingTag(navHTML, liStart, "<li", "</li>")
	if endIdx == -1 {
		return navHTML
	}

	var newLIs []string
	for i := 0; i < len(splitTitles); i++ {
		li := fmt.Sprintf(`      <li><a href="%s">%s</a></li>`, splitHrefs[i], splitTitles[i])
		newLIs = append(newLIs, li)
	}

	insertStr := "\n" + strings.Join(newLIs, "\n")
	return navHTML[:endIdx] + insertStr + navHTML[endIdx:]
}

func findWrappingNavPoint(ncxXML string, contentIdx int) (int, int) {
	pos := contentIdx
	for {
		navPointStart := strings.LastIndex(strings.ToLower(ncxXML[:pos]), "<navpoint")
		if navPointStart == -1 {
			return -1, -1
		}
		endIdx := findMatchingClosingTag(ncxXML, navPointStart, "<navpoint", "</navpoint>")
		if endIdx != -1 && endIdx > contentIdx {
			return navPointStart, endIdx
		}
		pos = navPointStart
	}
}

func findWrappingLI(navHTML string, hrefIdx int) (int, int) {
	pos := hrefIdx
	for {
		liStart := strings.LastIndex(strings.ToLower(navHTML[:pos]), "<li")
		if liStart == -1 {
			return -1, -1
		}
		endIdx := findMatchingClosingTag(navHTML, liStart, "<li", "</li>")
		if endIdx != -1 && endIdx > hrefIdx {
			return liStart, endIdx
		}
		pos = liStart
	}
}

type reorderBlockSlot struct {
	idref string
	start int
	end   int
	block string
}

func countPreviousChapterPath(chapters []models.Chapter, targetIndex int) int {
	targetPath := normalizeZipPath(chapters[targetIndex].Path)
	count := 0
	for i := 0; i < targetIndex; i++ {
		if normalizeZipPath(chapters[i].Path) == targetPath {
			count++
		}
	}
	return count
}

func hrefMatchesChapter(baseDir, href string, chapter models.Chapter) bool {
	src := html.UnescapeString(strings.TrimSpace(strings.Split(href, "#")[0]))
	if src == "" {
		return false
	}
	resolved := resolveZipHref(baseDir, src)
	if resolved != "" && normalizeZipPath(resolved) == normalizeZipPath(chapter.Path) {
		return true
	}
	return src == chapter.Href ||
		src == chapter.Path ||
		path.Base(src) == path.Base(chapter.Path) ||
		path.Base(src) == path.Base(chapter.Href)
}

func findKthNCXMatchByChapter(ncxXML string, chapter models.Chapter, occurrence int, baseDir string) int {
	re := regexp.MustCompile(`(?is)<content\b[^>]*\bsrc\s*=\s*["']([^"']*)["'][^>]*>`)
	matches := re.FindAllStringSubmatchIndex(ncxXML, -1)
	seen := 0
	for _, match := range matches {
		if len(match) < 4 {
			continue
		}
		src := ncxXML[match[2]:match[3]]
		if !hrefMatchesChapter(baseDir, src, chapter) {
			continue
		}
		if seen == occurrence {
			return match[0]
		}
		seen++
	}
	return -1
}

func findKthNavMatchByChapter(navHTML string, chapter models.Chapter, occurrence int, baseDir string) int {
	re := regexp.MustCompile(`(?is)<a\b[^>]*\bhref\s*=\s*["']([^"']*)["'][^>]*>`)
	matches := re.FindAllStringSubmatchIndex(navHTML, -1)
	seen := 0
	for _, match := range matches {
		if len(match) < 4 {
			continue
		}
		href := navHTML[match[2]:match[3]]
		if !hrefMatchesChapter(baseDir, href, chapter) {
			continue
		}
		if seen == occurrence {
			return match[0]
		}
		seen++
	}
	return -1
}

func replacePhysicalBlockSlots(text string, slots []reorderBlockSlot, desiredBlocks []string) string {
	if len(slots) < 2 || len(slots) != len(desiredBlocks) {
		return text
	}
	for i := 0; i < len(slots)-1; i++ {
		for j := i + 1; j < len(slots); j++ {
			if slots[i].start > slots[j].start {
				slots[i], slots[j] = slots[j], slots[i]
			}
		}
	}
	for i := len(slots) - 1; i >= 0; i-- {
		text = text[:slots[i].start] + desiredBlocks[i] + text[slots[i].end:]
	}
	return text
}

func reorderNCXPointsByChapters(ncxXML string, oldChapters, newChapters []models.Chapter, ncxDir string) string {
	slotsByID := make(map[string]reorderBlockSlot, len(oldChapters))
	var physicalSlots []reorderBlockSlot
	for idx, ch := range oldChapters {
		contentIdx := findKthNCXMatchByChapter(ncxXML, ch, countPreviousChapterPath(oldChapters, idx), ncxDir)
		if contentIdx == -1 {
			continue
		}
		start, end := findWrappingNavPoint(ncxXML, contentIdx)
		if start == -1 || end == -1 {
			continue
		}
		slot := reorderBlockSlot{idref: ch.IDRef, start: start, end: end, block: ncxXML[start:end]}
		slotsByID[ch.IDRef] = slot
		physicalSlots = append(physicalSlots, slot)
	}

	desiredBlocks := make([]string, 0, len(physicalSlots))
	for _, ch := range newChapters {
		if slot, ok := slotsByID[ch.IDRef]; ok {
			desiredBlocks = append(desiredBlocks, slot.block)
		}
	}
	return replacePhysicalBlockSlots(ncxXML, physicalSlots, desiredBlocks)
}

func reorderNavLIsByChapters(navHTML string, oldChapters, newChapters []models.Chapter, navDir string) string {
	slotsByID := make(map[string]reorderBlockSlot, len(oldChapters))
	var physicalSlots []reorderBlockSlot
	for idx, ch := range oldChapters {
		hrefIdx := findKthNavMatchByChapter(navHTML, ch, countPreviousChapterPath(oldChapters, idx), navDir)
		if hrefIdx == -1 {
			continue
		}
		start, end := findWrappingLI(navHTML, hrefIdx)
		if start == -1 || end == -1 {
			continue
		}
		slot := reorderBlockSlot{idref: ch.IDRef, start: start, end: end, block: navHTML[start:end]}
		slotsByID[ch.IDRef] = slot
		physicalSlots = append(physicalSlots, slot)
	}

	desiredBlocks := make([]string, 0, len(physicalSlots))
	for _, ch := range newChapters {
		if slot, ok := slotsByID[ch.IDRef]; ok {
			desiredBlocks = append(desiredBlocks, slot.block)
		}
	}
	return replacePhysicalBlockSlots(navHTML, physicalSlots, desiredBlocks)
}

func renumberPlayOrder(ncxXML string) string {
	re := regexp.MustCompile(`(?i)\bplayOrder\s*=\s*["']([^"']*)["']`)
	order := 1
	return re.ReplaceAllStringFunc(ncxXML, func(match string) string {
		res := fmt.Sprintf(`playOrder="%d"`, order)
		order++
		return res
	})
}

func insertNCXPointAfter(ncxXML string, chapters []models.Chapter, targetIndex int, title string, href string, id string) string {
	ch := chapters[targetIndex]
	k := getSpineOccurrenceCount(chapters, targetIndex)
	contentIdx := findKthNCXMatch(ncxXML, ch.Href, k)
	if contentIdx == -1 {
		return ncxXML
	}

	navPointStart := strings.LastIndex(strings.ToLower(ncxXML[:contentIdx]), "<navpoint")
	if navPointStart == -1 {
		return ncxXML
	}

	endIdx := findMatchingClosingTag(ncxXML, navPointStart, "<navpoint", "</navpoint>")
	if endIdx == -1 {
		return ncxXML
	}

	np := fmt.Sprintf("\n    <navPoint id=\"%s\" playOrder=\"\">\n      <navLabel>\n        <text>%s</text>\n      </navLabel>\n      <content src=\"%s\"/>\n    </navPoint>", id, title, href)
	return ncxXML[:endIdx] + np + ncxXML[endIdx:]
}

func insertNavLIAfter(navHTML string, chapters []models.Chapter, targetIndex int, title string, href string) string {
	ch := chapters[targetIndex]
	k := getSpineOccurrenceCount(chapters, targetIndex)
	hrefIdx := findKthNavMatch(navHTML, ch.Href, k)
	if hrefIdx == -1 {
		return navHTML
	}

	liStart := strings.LastIndex(strings.ToLower(navHTML[:hrefIdx]), "<li")
	if liStart == -1 {
		return navHTML
	}

	endIdx := findMatchingClosingTag(navHTML, liStart, "<li", "</li>")
	if endIdx == -1 {
		return navHTML
	}

	li := fmt.Sprintf("\n      <li><a href=\"%s\">%s</a></li>", href, title)
	return navHTML[:endIdx] + li + navHTML[endIdx:]
}
