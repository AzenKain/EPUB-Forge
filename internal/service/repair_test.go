package service

import (
	"strings"
	"testing"
)

func TestRepairXHTMLEntities(t *testing.T) {
	input := `<html xmlns="http://www.w3.org/1999/xhtml"><body><p>A&nbsp;B &copy; C & unknown &madeup;</p></body></html>`
	fixed, count := repairXHTMLEntities(input)
	if count != 4 {
		t.Fatalf("count = %d, want 4; fixed=%s", count, fixed)
	}
	if strings.Contains(fixed, "&nbsp;") {
		t.Fatalf("fixed still contains &nbsp;: %s", fixed)
	}
	if !strings.Contains(fixed, "A&#160;B") {
		t.Fatalf("fixed missing numeric nbsp replacement: %s", fixed)
	}
	if !strings.Contains(fixed, "&amp; unknown") {
		t.Fatalf("fixed missing bare ampersand escape: %s", fixed)
	}
	if !strings.Contains(fixed, "&amp;madeup;") {
		t.Fatalf("fixed missing unknown entity escape: %s", fixed)
	}
	if err := validateXMLWellFormed(fixed); err != nil {
		t.Fatalf("fixed XML is not well-formed: %v\n%s", err, fixed)
	}
}

func TestIsChapterTitleMissing(t *testing.T) {
	tests := []struct {
		name    string
		content string
		want    bool
	}{
		{
			name:    "No heading at all",
			content: `<html><body><p>Hello world</p></body></html>`,
			want:    true,
		},
		{
			name:    "Heading at the beginning",
			content: `<html><body><h2>Chapter Title</h2><p>Hello world</p></body></html>`,
			want:    false,
		},
		{
			name:    "Heading at the beginning with spaces and comments",
			content: `<html><body>  <!-- comment -->  <h2>Chapter Title</h2><p>Hello world</p></body></html>`,
			want:    false,
		},
		{
			name:    "Heading at the end (notes case)",
			content: `<html><body><p>Hello world</p><h2>Ghi chú</h2></body></html>`,
			want:    true,
		},
		{
			name:    "Heading at the end with HTML entities",
			content: `<html><body><p>&nbsp;Hello&nbsp;world&nbsp;</p><h2>Ghi chú</h2></body></html>`,
			want:    true,
		},
		{
			name:    "Fragment - no heading",
			content: `<p>Hello world</p>`,
			want:    true,
		},
		{
			name:    "Fragment - heading at beginning",
			content: `<h2>Chapter Title</h2><p>Hello world</p>`,
			want:    false,
		},
		{
			name:    "Fragment - heading at end",
			content: `<p>Hello world</p><h2>Notes</h2>`,
			want:    true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := isChapterTitleMissing(tt.content)
			if got != tt.want {
				t.Errorf("isChapterTitleMissing() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestValidateXMLWellFormed(t *testing.T) {
	tests := []struct {
		name    string
		content string
		wantErr bool
	}{
		{
			name:    "Well-formed XML",
			content: `<root><child>text</child></root>`,
			wantErr: false,
		},
		{
			name:    "Malformed - mismatched tag",
			content: `<root><child>text</root></child>`,
			wantErr: true,
		},
		{
			name:    "Malformed - missing close tag",
			content: `<root><child>text</child>`,
			wantErr: true,
		},
		{
			name:    "Malformed - XML syntax error (navMap closed by navPoint)",
			content: `<ncx><navMap><navPoint></navMap></navPoint></ncx>`,
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := validateXMLWellFormed(tt.content)
			if (err != nil) != tt.wantErr {
				t.Errorf("validateXMLWellFormed() error = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}

func TestRepairFixForIssue(t *testing.T) {
	tests := []struct {
		code      string
		wantFixID string
		wantOk    bool
	}{
		{"MANIFEST_ORPHAN_DOCUMENT", "REMOVE_MISSING_MANIFEST_ITEMS", true},
		{"NCX_DUMMY_DUPLICATE_LINK", "FIX_TOC_NCX", true},
		{"NCX_TARGET_NOT_IN_SPINE", "FIX_TOC_NCX", true},
		{"TOC_NAV_NCX_MISMATCH", "FIX_TOC_NCX", true},
		{"MANIFEST_FILE_MISSING", "REMOVE_MISSING_MANIFEST_ITEMS", true},
		{"UNKNOWN_CODE", "", false},
	}

	for _, tt := range tests {
		t.Run(tt.code, func(t *testing.T) {
			fixID, ok := repairFixForIssue(tt.code)
			if ok != tt.wantOk || fixID != tt.wantFixID {
				t.Errorf("repairFixForIssue(%q) = (%q, %v), want (%q, %v)", tt.code, fixID, ok, tt.wantFixID, tt.wantOk)
			}
		})
	}
}

func TestParseNavTOCPoints(t *testing.T) {
	navHTML := `
<nav epub:type="toc">
  <ol>
    <li><a href="c1.xhtml">Chapter 1</a></li>
    <li><a href="c2.xhtml#part1">Chapter 2</a></li>
  </ol>
</nav>`
	points := parseNavTOCPoints(navHTML, "OEBPS/Text")
	if len(points) != 2 {
		t.Fatalf("parseNavTOCPoints len = %d, want 2", len(points))
	}
	if points[0].Title != "Chapter 1" || points[0].FullPath != "OEBPS/Text/c1.xhtml" {
		t.Errorf("point[0] = %+v, want Title='Chapter 1', FullPath='OEBPS/Text/c1.xhtml'", points[0])
	}
	if points[1].Title != "Chapter 2" || points[1].FullPath != "OEBPS/Text/c2.xhtml" {
		t.Errorf("point[1] = %+v, want Title='Chapter 2', FullPath='OEBPS/Text/c2.xhtml'", points[1])
	}
}



