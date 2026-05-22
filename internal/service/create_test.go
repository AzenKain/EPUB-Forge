package service

import "testing"

func TestRewriteRawChapterAssetRefsUsesTextRelativePaths(t *testing.T) {
	html := `<p><img src="images/image_1.jpg" alt="cover"></p>`
	assets := map[string]string{"images/image_1.jpg": "AAAA"}

	got := rewriteRawChapterAssetRefs(html, assets)
	want := `<p><img src="../images/image_1.jpg" alt="cover"></p>`

	if got != want {
		t.Fatalf("rewriteRawChapterAssetRefs() = %q, want %q", got, want)
	}
}

func TestRewriteRawChapterAssetRefsLeavesExternalRefs(t *testing.T) {
	html := `<p><img src="https://img.jukaza.site/image.jpg"></p>`
	assets := map[string]string{"images/image_1.jpg": "AAAA"}

	got := rewriteRawChapterAssetRefs(html, assets)
	if got != html {
		t.Fatalf("rewriteRawChapterAssetRefs() = %q, want %q", got, html)
	}
}
