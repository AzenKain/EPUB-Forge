package service

import (
	"errors"
	"fmt"
	"regexp"
	"strings"

	"epubforge/internal/models"
)

func (s *Service) Find(id string, req models.FindRequest) (models.FindResponse, error) {
	lock := s.getBookLock(id)
	lock.Lock()
	defer lock.Unlock()

	ctx, err := loadBook(id)
	if err != nil {
		return models.FindResponse{}, err
	}
	defer ctx.Close()

	pattern := req.Query
	if req.Mode == "normal" {
		pattern = regexp.QuoteMeta(req.Query)
	}
	prefix := ""
	if !req.CaseSensitive {
		prefix += "i"
	}
	if req.Mode == "regex" && req.DotAll {
		prefix += "s"
	}
	if prefix != "" {
		pattern = "(?" + prefix + ")" + pattern
	}

	re, err := regexp.Compile(pattern)
	if err != nil {
		return models.FindResponse{}, fmt.Errorf("invalid search pattern: %w", err)
	}

	var matches []models.FindMatch

	var chaptersToSearch []Chapter
	if req.Scope == "current" {
		if req.ChapterIndex < 0 || req.ChapterIndex >= len(ctx.Chapters) {
			return models.FindResponse{}, errors.New("invalid chapter index")
		}
		chaptersToSearch = []Chapter{ctx.Chapters[req.ChapterIndex]}
	} else {
		chaptersToSearch = ctx.Chapters
	}

	matches = findChapterMatches(ctx, chaptersToSearch, re)

	return models.FindResponse{Matches: matches}, nil
}

func (s *Service) Replace(id string, req models.ReplaceRequest) (models.ReplaceResponse, error) {
	lock := s.getBookLock(id)
	lock.Lock()
	defer lock.Unlock()

	ctx, err := loadBook(id)
	if err != nil {
		return models.ReplaceResponse{}, err
	}
	defer ctx.Close()

	pattern := req.Query
	if req.Mode == "normal" {
		pattern = regexp.QuoteMeta(req.Query)
	}
	prefix := ""
	if !req.CaseSensitive {
		prefix += "i"
	}
	if req.Mode == "regex" && req.DotAll {
		prefix += "s"
	}
	if prefix != "" {
		pattern = "(?" + prefix + ")" + pattern
	}

	re, err := regexp.Compile(pattern)
	if err != nil {
		return models.ReplaceResponse{}, fmt.Errorf("invalid search pattern: %w", err)
	}

	editedFiles := make(map[string][]byte)
	replacedCount := 0

	if req.ReplaceAll {
		var chaptersToSearch []Chapter
		if req.Scope == "current" {
			if req.ChapterIndex < 0 || req.ChapterIndex >= len(ctx.Chapters) {
				return models.ReplaceResponse{}, errors.New("invalid chapter index")
			}
			chaptersToSearch = []Chapter{ctx.Chapters[req.ChapterIndex]}
		} else {
			chaptersToSearch = ctx.Chapters
		}

		editedFiles, replacedCount = replaceAllChapterMatches(ctx, chaptersToSearch, re, req)
	} else {
		var chaptersToSearch []Chapter
		if req.Scope == "current" {
			if req.ChapterIndex < 0 || req.ChapterIndex >= len(ctx.Chapters) {
				return models.ReplaceResponse{}, errors.New("invalid chapter index")
			}
			chaptersToSearch = []Chapter{ctx.Chapters[req.ChapterIndex]}
		} else {
			chaptersToSearch = ctx.Chapters
		}

		var allMatches []matchInfo

		allMatches = collectReplaceMatches(ctx, chaptersToSearch, re)

		if req.MatchIndex < 0 || req.MatchIndex >= len(allMatches) {
			return models.ReplaceResponse{}, fmt.Errorf("invalid match index: %d", req.MatchIndex)
		}

		targetMatch := allMatches[req.MatchIndex]
		content, err := ctx.readText(targetMatch.chPath)
		if err != nil {
			return models.ReplaceResponse{}, fmt.Errorf("failed to read chapter: %w", err)
		}

		if targetMatch.start >= 0 && targetMatch.end <= len(content) && targetMatch.start <= targetMatch.end {
			var replacementStr string
			if req.Mode == "regex" {
				matchContent := content[targetMatch.start:targetMatch.end]
				submatchIndices := re.FindStringSubmatchIndex(matchContent)
				if submatchIndices != nil {
					dst := re.ExpandString(nil, req.Replacement, matchContent, submatchIndices)
					replacementStr = string(dst)
				} else {
					replacementStr = req.Replacement
				}
			} else {
				replacementStr = req.Replacement
			}

			newContent := content[:targetMatch.start] + replacementStr + content[targetMatch.end:]
			editedFiles[targetMatch.chPath] = []byte(newContent)
			replacedCount = 1
		} else {
			return models.ReplaceResponse{}, errors.New("match bounds out of range")
		}
	}

	if replacedCount > 0 {
		if err := s.pushUndoSnapshot(id); err != nil {
			return models.ReplaceResponse{}, err
		}
		newFileName, err := ctx.writeEditedEPUB(editedFiles)
		if err != nil {
			return models.ReplaceResponse{}, fmt.Errorf("failed to write EPUB: %w", err)
		}

		newID := toID(newFileName)
		newCtx, err := loadBook(newID)
		if err != nil {
			return models.ReplaceResponse{}, fmt.Errorf("failed to reload book: %w", err)
		}
		defer newCtx.Close()

		return models.ReplaceResponse{
			Success:       true,
			ReplacedCount: replacedCount,
			Analysis:      newCtx.Analysis(),
		}, nil
	}

	return models.ReplaceResponse{
		Success:       true,
		ReplacedCount: 0,
		Analysis:      ctx.Analysis(),
	}, nil
}

func findChapterMatches(ctx *BookContext, chapters []Chapter, re *regexp.Regexp) []models.FindMatch {
	if len(chapters) == 0 {
		return nil
	}

	results := make([][]models.FindMatch, len(chapters))
	runWorkers(len(chapters), func(idx int) {
		ch := chapters[idx]
		content, err := ctx.readText(ch.Path)
		if err != nil {
			return
		}

		indices := re.FindAllStringIndex(content, -1)
		if len(indices) == 0 {
			return
		}

		chapterMatches := make([]models.FindMatch, 0, len(indices))
		for _, loc := range indices {
			start := loc[0]
			end := loc[1]
			lineNum, lineContent, startCol, endCol := getLineNumAndContent(content, start, end)

			chapterMatches = append(chapterMatches, models.FindMatch{
				ChapterIndex: ch.Index,
				ChapterTitle: ch.Title,
				ChapterPath:  ch.Path,
				LineNumber:   lineNum,
				LineContent:  lineContent,
				StartCol:     startCol,
				EndCol:       endCol,
				StartOffset:  start,
				EndOffset:    end,
			})
		}
		results[idx] = chapterMatches
	})

	var matches []models.FindMatch
	for _, chapterMatches := range results {
		matches = append(matches, chapterMatches...)
	}
	return matches
}

func replaceAllChapterMatches(ctx *BookContext, chapters []Chapter, re *regexp.Regexp, req models.ReplaceRequest) (map[string][]byte, int) {
	type result struct {
		path  string
		data  []byte
		count int
	}

	results := make([]result, len(chapters))
	runWorkers(len(chapters), func(idx int) {
		ch := chapters[idx]
		content, err := ctx.readText(ch.Path)
		if err != nil {
			return
		}

		matchesCount := len(re.FindAllStringIndex(content, -1))
		if matchesCount == 0 {
			return
		}

		var newContent string
		if req.Mode == "regex" {
			newContent = re.ReplaceAllString(content, req.Replacement)
		} else {
			newContent = re.ReplaceAllStringFunc(content, func(string) string {
				return req.Replacement
			})
		}
		results[idx] = result{path: ch.Path, data: []byte(newContent), count: matchesCount}
	})

	editedFiles := make(map[string][]byte)
	replacedCount := 0
	for _, result := range results {
		if result.count == 0 {
			continue
		}
		editedFiles[result.path] = result.data
		replacedCount += result.count
	}
	return editedFiles, replacedCount
}

func collectReplaceMatches(ctx *BookContext, chapters []Chapter, re *regexp.Regexp) []matchInfo {
	results := make([][]matchInfo, len(chapters))
	runWorkers(len(chapters), func(idx int) {
		ch := chapters[idx]
		content, err := ctx.readText(ch.Path)
		if err != nil {
			return
		}

		indices := re.FindAllStringIndex(content, -1)
		if len(indices) == 0 {
			return
		}

		matches := make([]matchInfo, 0, len(indices))
		for _, loc := range indices {
			matches = append(matches, matchInfo{
				chPath: ch.Path,
				start:  loc[0],
				end:    loc[1],
			})
		}
		results[idx] = matches
	})

	var matches []matchInfo
	for _, chapterMatches := range results {
		matches = append(matches, chapterMatches...)
	}
	return matches
}

type matchInfo struct {
	chPath string
	start  int
	end    int
}

func getLineNumAndContent(content string, startIdx int, endIdx int) (int, string, int, int) {
	lineNum := 1
	lastNewline := -1
	for i := 0; i < startIdx; i++ {
		if content[i] == '\n' {
			lineNum++
			lastNewline = i
		}
	}

	nextNewline := len(content)
	for i := endIdx; i < len(content); i++ {
		if content[i] == '\n' {
			nextNewline = i
			break
		}
	}

	lineContent := content[lastNewline+1 : nextNewline]
	lineContent = strings.TrimSuffix(lineContent, "\r")
	startCol := len([]rune(content[lastNewline+1 : startIdx]))
	endCol := len([]rune(content[lastNewline+1 : endIdx]))
	return lineNum, lineContent, startCol, endCol
}
