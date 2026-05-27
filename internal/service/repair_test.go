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


