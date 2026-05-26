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
