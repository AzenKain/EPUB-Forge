package service

import (
	"epubforge/internal/models"
	"errors"
	"fmt"
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
	if strings.TrimSpace(title) == "" || title == "." {
		title = "Imported Text"
	}

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

	type textChapter struct {
		Title   string
		Content string
	}

	var chapters []textChapter
	if len(matches) == 0 {
		chapters = append(chapters, textChapter{
			Title:   "Chương 1",
			Content: content,
		})
	} else {
		if matches[0][0] > 0 {
			preamble := strings.TrimSpace(content[:matches[0][0]])
			if preamble != "" {
				chapters = append(chapters, textChapter{
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
			}

			if chapterTitle == "" {
				chapterTitle = fmt.Sprintf("Chương %d", len(chapters)+1)
			}

			chapters = append(chapters, textChapter{
				Title:   chapterTitle,
				Content: bodyText,
			})
		}
	}

	createChapters := make([]models.CreateEpubChapter, 0, len(chapters))
	for idx, chap := range chapters {
		createChapters = append(createChapters, models.CreateEpubChapter{
			ID:      fmt.Sprintf("import_%03d", idx+1),
			Title:   chap.Title,
			Mode:    "text",
			Text:    chap.Content,
			RawHTML: false,
		})
	}

	return s.CreateEpub(models.CreateEpubRequest{
		Title:  title,
		Author: "EPUBForge",
		Metadata: models.BookMetadata{
			Title:    title,
			Creator:  "EPUBForge",
			Language: "vi",
		},
		Direction: "ltr",
		Chapters:  createChapters,
	}, nil)
}
