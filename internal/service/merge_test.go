package service

import (
	"archive/zip"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestMergeEpubsPreservesMainBookMetadata(t *testing.T) {
	workspace := t.TempDir()
	svc, err := New(workspace, "test")
	if err != nil {
		t.Fatalf("New() failed: %v", err)
	}

	mainName := "main-metadata.epub"
	secondName := "second-metadata.epub"
	mainID := toID(mainName)
	secondID := toID(secondName)

	t.Cleanup(func() {
		closeZipReaderForBook(mainID, nil)
		closeZipReaderForBook(secondID, nil)
	})

	mainMetadata := BookMetadata{
		Title:       "Original Main Title",
		Creator:     "Jane Writer",
		Language:    "en",
		Publisher:   "Press House",
		Description: "A long description preserved from the source book.",
		Subject:     "Fantasy, Adventure",
		Series:      "Archive Series",
		SeriesIndex: "2.5",
	}
	writeMergeTestEPUB(t, filepath.Join(editDir, mainName), mainMetadata, true)
	writeMergeTestEPUB(t, filepath.Join(editDir, secondName), BookMetadata{
		Title:    "Second Book",
		Creator:  "Other Writer",
		Language: "vi",
	}, false)

	outputName, err := svc.MergeEpubs([]string{mainID, secondID}, "Merged Title")
	if err != nil {
		t.Fatalf("MergeEpubs() failed: %v", err)
	}
	outputID := toID(outputName)
	t.Cleanup(func() {
		closeZipReaderForBook(outputID, nil)
	})

	ctx, err := loadBook(outputID)
	if err != nil {
		t.Fatalf("loadBook(merged) failed: %v", err)
	}
	defer ctx.Close()

	got := ctx.Metadata
	want := BookMetadata{
		Title:       "Merged Title",
		Creator:     mainMetadata.Creator,
		Language:    mainMetadata.Language,
		Publisher:   mainMetadata.Publisher,
		Description: mainMetadata.Description,
		Subject:     mainMetadata.Subject,
		Series:      mainMetadata.Series,
		SeriesIndex: mainMetadata.SeriesIndex,
		CoverImage:  "b0/Images/cover.jpg",
	}
	if got != want {
		t.Fatalf("merged metadata mismatch:\n got: %#v\nwant: %#v", got, want)
	}

	opf := readMergeTestZipText(t, filepath.Join(editDir, outputName), "content.opf")
	for _, expected := range []string{
		"<dc:publisher>Press House</dc:publisher>",
		"<dc:description>A long description preserved from the source book.</dc:description>",
		"<dc:subject>Fantasy, Adventure</dc:subject>",
		`<meta property="belongs-to-collection">Archive Series</meta>`,
		`<meta name="calibre:series" content="Archive Series"/>`,
		`<meta property="group-position">2.5</meta>`,
		`<meta name="calibre:series_index" content="2.5"/>`,
		`<meta name="cover" content="b0_cover-img"/>`,
	} {
		if !strings.Contains(opf, expected) {
			t.Fatalf("merged OPF missing %q:\n%s", expected, opf)
		}
	}
}

func writeMergeTestEPUB(t *testing.T, filePath string, metadata BookMetadata, withCover bool) {
	t.Helper()

	f, err := os.Create(filePath)
	if err != nil {
		t.Fatalf("create test EPUB: %v", err)
	}
	zw := zip.NewWriter(f)

	if err := writeStoredMimetype(zw); err != nil {
		t.Fatalf("write mimetype: %v", err)
	}
	if err := writeZipText(zw, "META-INF/container.xml", `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`); err != nil {
		t.Fatalf("write container: %v", err)
	}

	coverMeta := ""
	coverItem := ""
	if withCover {
		coverMeta = `    <meta name="cover" content="cover-img"/>` + "\n"
		coverItem = `    <item id="cover-img" href="Images/cover.jpg" media-type="image/jpeg" properties="cover-image" />` + "\n"
	}

	opf := fmt.Sprintf(`<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="pub-id" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>%s</dc:title>
    <dc:creator>%s</dc:creator>
    <dc:language>%s</dc:language>
    <dc:identifier id="pub-id">uuid-test</dc:identifier>
    <dc:publisher>%s</dc:publisher>
    <dc:description>%s</dc:description>
    <dc:subject>%s</dc:subject>
    <meta property="belongs-to-collection">%s</meta>
    <meta name="calibre:series" content="%s"/>
    <meta property="group-position">%s</meta>
    <meta name="calibre:series_index" content="%s"/>
%s  </metadata>
  <manifest>
    <item id="c1" href="Text/ch1.xhtml" media-type="application/xhtml+xml" />
%s  </manifest>
  <spine>
    <itemref idref="c1" />
  </spine>
</package>`,
		escapeXML(metadata.Title),
		escapeXML(metadata.Creator),
		escapeXML(metadata.Language),
		escapeXML(metadata.Publisher),
		escapeXML(metadata.Description),
		escapeXML(metadata.Subject),
		escapeXML(metadata.Series),
		escapeXML(metadata.Series),
		escapeXML(metadata.SeriesIndex),
		escapeXML(metadata.SeriesIndex),
		coverMeta,
		coverItem,
	)
	if err := writeZipText(zw, "content.opf", opf); err != nil {
		t.Fatalf("write OPF: %v", err)
	}
	if err := writeZipText(zw, "Text/ch1.xhtml", fmt.Sprintf(`<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>%s</title></head>
<body><h1>%s</h1><p>Body</p></body>
</html>`, escapeXML(metadata.Title), escapeXML(metadata.Title))); err != nil {
		t.Fatalf("write chapter: %v", err)
	}
	if withCover {
		if err := writeZipBytes(zw, "Images/cover.jpg", []byte{0xff, 0xd8, 0xff, 0xd9}); err != nil {
			t.Fatalf("write cover: %v", err)
		}
	}
	if err := zw.Close(); err != nil {
		_ = f.Close()
		t.Fatalf("close zip: %v", err)
	}
	if err := f.Close(); err != nil {
		t.Fatalf("close file: %v", err)
	}
}

func readMergeTestZipText(t *testing.T, filePath, name string) string {
	t.Helper()

	reader, err := zip.OpenReader(filePath)
	if err != nil {
		t.Fatalf("open merged zip: %v", err)
	}
	defer reader.Close()

	for _, f := range reader.File {
		if f.Name != name {
			continue
		}
		data, err := readZipFile(f)
		if err != nil {
			t.Fatalf("read %s: %v", name, err)
		}
		return string(data)
	}
	t.Fatalf("missing %s in %s", name, filePath)
	return ""
}
