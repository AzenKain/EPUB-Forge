package service

import (
	"epubforge/internal/models"
	"os"
	"path/filepath"
	"testing"
)

func TestSeriesFolderAutoCreationAndReUse(t *testing.T) {
	workspace := t.TempDir()
	svc, err := New(workspace, "test")
	if err != nil {
		t.Fatalf("New() failed: %v", err)
	}

	// 1. Create Volume 1 of series "Overlord LN"
	req1 := models.CreateEpubRequest{
		Title: "Tập 1 - Kẻ Bất Tử",
		Metadata: models.BookMetadata{
			Title:  "Tập 1 - Kẻ Bất Tử",
			Series: "Overlord LN",
		},
		Chapters: []models.CreateEpubChapter{
			{
				ID:    "c1",
				Title: "Chương 1",
				Mode:  "normal",
				Text:  "<p>Nội dung chương 1</p>",
			},
		},
	}
	out1, err := svc.CreateEpub(req1, nil)
	if err != nil {
		t.Fatalf("CreateEpub(vol1) failed: %v", err)
	}
	if filepath.ToSlash(filepath.Dir(out1)) != "Overlord LN" {
		t.Errorf("Expected out1 dir to be 'Overlord LN', got: %s", out1)
	}
	vol1Path := filepath.Join(editDir, out1)
	if _, err := os.Stat(vol1Path); err != nil {
		t.Fatalf("Expected file at %s, got err: %v", vol1Path, err)
	}

	// 2. Create Volume 2 with case-differing series name "overlord ln"
	req2 := models.CreateEpubRequest{
		Title: "Tập 2 - Chiến Binh Đen",
		Metadata: models.BookMetadata{
			Title:  "Tập 2 - Chiến Binh Đen",
			Series: "overlord ln",
		},
		Chapters: []models.CreateEpubChapter{
			{
				ID:    "c1",
				Title: "Chương 1",
				Mode:  "normal",
				Text:  "<p>Nội dung chương 2</p>",
			},
		},
	}
	out2, err := svc.CreateEpub(req2, nil)
	if err != nil {
		t.Fatalf("CreateEpub(vol2) failed: %v", err)
	}
	if filepath.ToSlash(filepath.Dir(out2)) != "Overlord LN" {
		t.Errorf("Expected out2 to reuse existing directory 'Overlord LN', got: %s", out2)
	}

	// 3. Verify ListEpubs returns both books with correct folder and path
	list, err := svc.ListEpubs()
	if err != nil {
		t.Fatalf("ListEpubs() failed: %v", err)
	}
	if len(list) != 2 {
		t.Fatalf("Expected 2 books in list, got: %d", len(list))
	}
	for _, b := range list {
		if b.Folder != "Overlord LN" {
			t.Errorf("Expected book %s to have Folder 'Overlord LN', got: %s", b.Name, b.Folder)
		}
	}

	// 4. Test MoveEpub back to root
	id1 := toID(out1)
	moved, err := svc.MoveEpub(id1, "")
	if err != nil {
		t.Fatalf("MoveEpub to root failed: %v", err)
	}
	if moved.Folder != "" {
		t.Errorf("Expected moved book folder to be empty, got: %s", moved.Folder)
	}
	if _, err := os.Stat(filepath.Join(editDir, moved.Name)); err != nil {
		t.Errorf("Expected file at root: %v", err)
	}

	// 5. Test MoveEpub to a new folder
	movedBack, err := svc.MoveEpub(moved.ID, "Custom Folder")
	if err != nil {
		t.Fatalf("MoveEpub to Custom Folder failed: %v", err)
	}
	if movedBack.Folder != "Custom Folder" {
		t.Errorf("Expected movedBack folder to be 'Custom Folder', got: %s", movedBack.Folder)
	}

	// 6. Test Folder rename
	if err := svc.RenameFolder("Custom Folder", "Overlord LN"); err == nil {
		t.Errorf("Expected error renaming to existing folder 'Overlord LN', got nil")
	}
	if err := svc.RenameFolder("Custom Folder", "New Series Folder"); err != nil {
		t.Fatalf("RenameFolder failed: %v", err)
	}

	// 7. Verify ListFolders
	folders, err := svc.ListFolders()
	if err != nil {
		t.Fatalf("ListFolders failed: %v", err)
	}
	if len(folders) != 2 {
		t.Fatalf("Expected 2 folders, got: %v", folders)
	}
}

func TestIDSecurityAndPathDepth(t *testing.T) {
	// Root file
	id1 := toID("my_book.epub")
	name1, err := fromID(id1)
	if err != nil || name1 != "my_book.epub" {
		t.Errorf("Valid root id failed: %v, got %s", err, name1)
	}

	// 1-level subfolder
	id2 := toID("Series Name/Volume 1.epub")
	name2, err := fromID(id2)
	if err != nil || filepath.ToSlash(name2) != "Series Name/Volume 1.epub" {
		t.Errorf("Valid 1-level id failed: %v, got %s", err, name2)
	}

	// Traversal attempt
	idBad1 := toID("../secret.epub")
	if _, err := fromID(idBad1); err == nil {
		t.Errorf("Expected error for traversal path, got nil")
	}

	// Depth > 1 attempt
	idBad2 := toID("Folder1/Folder2/book.epub")
	if _, err := fromID(idBad2); err == nil {
		t.Errorf("Expected error for depth > 1, got nil")
	}

	// Hidden directory attempt
	idBad3 := toID(".overlay/book.epub")
	if _, err := fromID(idBad3); err == nil {
		t.Errorf("Expected error for hidden directory, got nil")
	}
}
