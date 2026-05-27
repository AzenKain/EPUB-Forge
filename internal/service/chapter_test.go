package service

import (
	"strings"
	"testing"

	"epubforge/internal/models"
)

func TestReorderNavLIsByChaptersPreservesVisibleTOCBlocks(t *testing.T) {
	oldChapters := []models.Chapter{
		{IDRef: "c1", Href: "chapter_001.xhtml", Path: "OEBPS/Text/chapter_001.xhtml", Title: "One"},
		{IDRef: "c2", Href: "chapter_002.xhtml", Path: "OEBPS/Text/chapter_002.xhtml", Title: "Two"},
		{IDRef: "c3", Href: "chapter_003.xhtml", Path: "OEBPS/Text/chapter_003.xhtml", Title: "Three"},
	}
	newChapters := []models.Chapter{oldChapters[0], oldChapters[2], oldChapters[1]}
	visibleTOC := `<html><body><ul>
<li><a href="chapter_001.xhtml">One</a><div class="date">27/05/2026</div></li>
<li><a href="chapter_002.xhtml">Two</a><div class="date">27/05/2026</div></li>
<li><a href="chapter_003.xhtml">Three</a><div class="date">27/05/2026</div></li>
</ul></body></html>`

	got := reorderNavLIsByChapters(visibleTOC, oldChapters, newChapters, "OEBPS/Text/")

	posTwo := strings.Index(got, `href="chapter_002.xhtml"`)
	posThree := strings.Index(got, `href="chapter_003.xhtml"`)
	if posTwo == -1 || posThree == -1 {
		t.Fatalf("reordered TOC is missing expected links:\n%s", got)
	}
	if posThree > posTwo {
		t.Fatalf("chapter_003 should appear before chapter_002 after reorder:\n%s", got)
	}
	if strings.Count(got, `class="date"`) != 3 {
		t.Fatalf("visible TOC block content was not preserved:\n%s", got)
	}
}
