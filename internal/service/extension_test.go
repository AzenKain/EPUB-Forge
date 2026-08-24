package service

import (
	"archive/zip"
	"bytes"
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/dop251/goja"
)

func TestFormatJSPanicUsesJSErrorMessage(t *testing.T) {
	vm := goja.New()
	_, runErr := vm.RunString(`throw new Error("Login failed: wrong password")`)
	if runErr == nil {
		t.Fatal("expected JavaScript exception")
	}

	var ex *goja.Exception
	if !errors.As(runErr, &ex) {
		t.Fatalf("expected goja exception, got %T", runErr)
	}

	err := formatJSPanic(vm, ex)
	if err == nil {
		t.Fatal("expected formatted error")
	}
	if got, want := err.Error(), "Login failed: wrong password"; got != want {
		t.Fatalf("formatted error = %q, want %q", got, want)
	}
	if strings.Contains(err.Error(), "JS execution panic") {
		t.Fatalf("formatted error should not include panic prefix: %q", err.Error())
	}
}

func TestExtensionChoiceFlow(t *testing.T) {
	svc := &Service{}
	run := &ActiveRun{SessionID: "run_test"}
	var logs bytes.Buffer
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	selectedCh := make(chan []string, 1)
	errCh := make(chan error, 1)
	go func() {
		selected, err := svc.waitForExtensionChoice(ctx, run, &logs, "Pick volumes", []any{
			map[string]any{"id": "1", "label": "Vol 1"},
			map[string]any{"id": "2", "label": "Vol 2"},
		}, true)
		if err != nil {
			errCh <- err
			return
		}
		selectedCh <- selected
	}()

	deadline := time.Now().Add(2 * time.Second)
	for {
		run.ChoiceMu.Lock()
		ready := run.ChoiceCh != nil
		run.ChoiceMu.Unlock()
		if ready {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("choice prompt was not registered")
		}
		time.Sleep(10 * time.Millisecond)
	}

	if !strings.Contains(logs.String(), `"type":"choice_required"`) {
		t.Fatalf("choice event was not written to logs: %s", logs.String())
	}
	if err := answerExtensionChoice(run, `["2"]`); err != nil {
		t.Fatalf("answer choice: %v", err)
	}

	select {
	case selected := <-selectedCh:
		if len(selected) != 1 || selected[0] != "2" {
			t.Fatalf("selected = %#v, want [2]", selected)
		}
	case err := <-errCh:
		t.Fatalf("choice returned error: %v", err)
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for selected choice")
	}
}

func TestValvrareteamExtension(t *testing.T) {
	if testing.Short() || os.Getenv("CI") != "" {
		t.Skip("skipping network extension test in short/CI mode")
	}
	svc, err := New(t.TempDir(), "dev")
	if err != nil {
		t.Fatalf("failed to init service: %v", err)
	}
	defer svc.Close()

	params := map[string]any{
		"url":             "https://valvrareteam.net/truyen/lam-lai-cuoc-doi-sau-khi-bi-cam-sung-va-vu-oan-toi-tro-nen-than-thiet-voi-nu-than-xinh-dep-nhat-truong-2f48bf12",
		"username":        os.Getenv("VALVRARE_USERNAME"),
		"password":        os.Getenv("VALVRARE_PASSWORD"),
		"downloadMode":    "chapter_range",
		"startChapterUrl": "https://valvrareteam.net/truyen/lam-lai-cuoc-doi-sau-khi-bi-cam-sung-va-vu-oan-toi-tro-nen-than-thiet-voi-nu-than-xinh-dep-nhat-truong-2f48bf12/chuong/minh-hoa-2f48c0b7",
		"endChapterUrl":   "https://valvrareteam.net/truyen/lam-lai-cuoc-doi-sau-khi-bi-cam-sung-va-vu-oan-toi-tro-nen-than-thiet-voi-nu-than-xinh-dep-nhat-truong-2f48bf12/chuong/chuong-1-bat-qua-tang-ngoai-tinh-va-bi-bat-nat-2f48c23c",
	}

	var logs bytes.Buffer
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	createdFiles, warnings, err := svc.RunExtension(ctx, "valvrareteam2epub", params, &logs)
	if err != nil {
		t.Fatalf("RunExtension failed: %v\nLogs:\n%s", err, logs.String())
	}

	if len(createdFiles) == 0 {
		t.Fatalf("expected at least 1 created epub file, got 0\nLogs:\n%s", logs.String())
	}

	t.Logf("Created %d EPUB file(s): %v, warnings: %v", len(createdFiles), createdFiles, warnings)
}

func TestHakoExtension(t *testing.T) {
	if testing.Short() || os.Getenv("CI") != "" {
		t.Skip("skipping network extension test in short/CI mode")
	}
	tmpDir := t.TempDir()
	svc, err := New(tmpDir, "dev")
	if err != nil {
		t.Fatalf("failed to init service: %v", err)
	}
	defer svc.Close()

	params := map[string]any{
		"url":             "https://docln.sbs/truyen/25592-co-ban-cung-lop-duoc-yeu-quy-chi-mim-cuoi-voi-toi",
		"downloadMode":    "single_chapter",
		"startChapterUrl": "https://docln.sbs/truyen/25592-co-ban-cung-lop-duoc-yeu-quy-chi-mim-cuoi-voi-toi/c345139-minh-hoa",
		"endChapterUrl":   "https://docln.sbs/truyen/25592-co-ban-cung-lop-duoc-yeu-quy-chi-mim-cuoi-voi-toi/c345139-minh-hoa",
	}

	var logs bytes.Buffer
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	createdFiles, warnings, err := svc.RunExtension(ctx, "hako2epub", params, &logs)
	t.Logf("LOGS:\n%s", logs.String())
	if err != nil {
		t.Fatalf("RunExtension failed: %v", err)
	}
	if len(createdFiles) == 0 {
		t.Fatalf("expected created epub files, got 0")
	}
	t.Logf("Created %d EPUB file(s): %v, warnings: %v", len(createdFiles), createdFiles, warnings)

	epubPath := filepath.Join(tmpDir, "edit", createdFiles[0])
	r, err := zip.OpenReader(epubPath)
	if err != nil {
		t.Fatalf("zip.OpenReader failed: %v", err)
	}
	defer r.Close()

	var imageCount int
	for _, f := range r.File {
		if strings.HasPrefix(f.Name, "OEBPS/images/") || strings.HasPrefix(f.Name, "images/") {
			imageCount++
			t.Logf("Embedded image inside EPUB: %s (size: %d bytes)", f.Name, f.UncompressedSize64)
		}
	}
	t.Logf("Total images inside generated EPUB: %d", imageCount)
}

func TestSonakoExtension(t *testing.T) {
	if testing.Short() || os.Getenv("CI") != "" {
		t.Skip("skipping network extension test in short/CI mode")
	}
	tmpDir := t.TempDir()
	svc, err := New(tmpDir, "dev")
	if err != nil {
		t.Fatalf("failed to init service: %v", err)
	}
	defer svc.Close()

	params := map[string]any{
		"url":             "https://sonako.fandom.com/vi/wiki/Taimadou_Gakuen_35_Shiken_Shoutai",
		"downloadMode":    "chapter_range",
		"startChapterUrl": "https://sonako.fandom.com/vi/wiki/Taimadou_Gakuen_35_Shiken_Shoutai_T%E1%BA%ADp_1_Minh_h%E1%BB%8Da",
		"endChapterUrl":   "https://sonako.fandom.com/vi/wiki/Taimadou_Gakuen_35_Shiken_Shoutai_T%E1%BA%ADp_1_Ch%C6%B0%C6%A1ng_1",
	}

	var logs bytes.Buffer
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	createdFiles, warnings, err := svc.RunExtension(ctx, "sonako2epub", params, &logs)
	t.Logf("LOGS:\n%s", logs.String())
	if err != nil {
		t.Fatalf("RunExtension failed: %v", err)
	}
	if len(createdFiles) == 0 {
		t.Fatalf("expected created epub files, got 0")
	}
	t.Logf("Created %d EPUB file(s): %v, warnings: %v", len(createdFiles), createdFiles, warnings)

	epubPath := filepath.Join(tmpDir, "edit", createdFiles[0])
	r, err := zip.OpenReader(epubPath)
	if err != nil {
		t.Fatalf("zip.OpenReader failed: %v", err)
	}
	defer r.Close()

	var imageCount int
	for _, f := range r.File {
		if strings.HasPrefix(f.Name, "OEBPS/images/") || strings.HasPrefix(f.Name, "images/") {
			imageCount++
			t.Logf("Embedded image inside EPUB: %s (size: %d bytes)", f.Name, f.UncompressedSize64)
		}
	}
	t.Logf("Total images inside generated EPUB: %d", imageCount)
	if imageCount == 0 {
		t.Fatalf("expected embedded illustration images, got 0")
	}
}

func TestZumiNovelExtension(t *testing.T) {
	if testing.Short() || os.Getenv("CI") != "" {
		t.Skip("skipping network extension test in short/CI mode")
	}
	tmpDir := t.TempDir()
	svc, err := New(tmpDir, "dev")
	if err != nil {
		t.Fatalf("failed to init service: %v", err)
	}
	defer svc.Close()

	params := map[string]any{
		"url":             "https://zuminovel.com/novel/khi-nhung-ao-tuong-thanh-xuan-tro-thanh-hien-thuc",
		"username":        os.Getenv("ZUMINOVEL_USERNAME"),
		"password":        os.Getenv("ZUMINOVEL_PASSWORD"),
		"downloadMode":    "chapter_range",
		"startChapterUrl": "https://zuminovel.com/novel/khi-nhung-ao-tuong-thanh-xuan-tro-thanh-hien-thuc/read/ton-tp/chuong1otuoithanhxuanhoangduong-697ae8dfe8959d50fc85c23f",
		"endChapterUrl":   "697ae8dfe8959d50fc85c245", // Chapter 2 ID
	}

	var logs bytes.Buffer
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	createdFiles, warnings, err := svc.RunExtension(ctx, "zuminovel2epub", params, &logs)
	t.Logf("LOGS:\n%s", logs.String())
	if err != nil {
		t.Fatalf("RunExtension failed: %v", err)
	}
	if len(createdFiles) == 0 {
		t.Fatalf("expected created epub files, got 0")
	}
	t.Logf("Created %d EPUB file(s): %v, warnings: %v", len(createdFiles), createdFiles, warnings)

	epubPath := filepath.Join(tmpDir, "edit", createdFiles[0])
	r, err := zip.OpenReader(epubPath)
	if err != nil {
		t.Fatalf("zip.OpenReader failed: %v", err)
	}
	defer r.Close()

	t.Logf("EPUB file verified successfully. Entries count: %d", len(r.File))
}

func TestZumiNovelMultiVolume(t *testing.T) {
	if testing.Short() || os.Getenv("CI") != "" {
		t.Skip("skipping network extension test in short/CI mode")
	}
	tmpDir := t.TempDir()
	svc, err := New(tmpDir, "dev")
	if err != nil {
		t.Fatalf("failed to init service: %v", err)
	}
	defer svc.Close()

	params := map[string]any{
		"url":             "https://zuminovel.com/novel/thap-nhat-chung-yen",
		"downloadMode":    "choose_volumes",
		"volumeSelection": "1",
		"startChapterUrl": "6a3cad423d774ead0e3d93aa", // Chap 1 of Volume 1
		"endChapterUrl":   "6a3cad423d774ead0e3d93b3", // Chap 2 of Volume 1
	}

	var logs bytes.Buffer
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	createdFiles, warnings, err := svc.RunExtension(ctx, "zuminovel2epub", params, &logs)
	t.Logf("LOGS:\n%s", logs.String())
	if err != nil {
		t.Fatalf("RunExtension failed: %v", err)
	}
	if len(createdFiles) == 0 {
		t.Fatalf("expected created epub files, got 0")
	}
	t.Logf("Created %d EPUB file(s): %v, warnings: %v", len(createdFiles), createdFiles, warnings)

	epubPath := filepath.Join(tmpDir, "edit", createdFiles[0])
	r, err := zip.OpenReader(epubPath)
	if err != nil {
		t.Fatalf("zip.OpenReader failed: %v", err)
	}
	defer r.Close()

	t.Logf("Multi-volume EPUB file verified successfully. Entries count: %d", len(r.File))
}

func TestNovestExtension(t *testing.T) {
	if testing.Short() || os.Getenv("CI") != "" {
		t.Skip("skipping network extension test in short/CI mode")
	}
	tmpDir := t.TempDir()
	svc, err := New(tmpDir, "dev")
	if err != nil {
		t.Fatalf("failed to init service: %v", err)
	}
	defer svc.Close()

	params := map[string]any{
		"url":             "https://novest.me/truyen/muon-am-tham-ket-noi-cung-dong-hao-ngot",
		"username":        os.Getenv("NOVEST_USERNAME"),
		"password":        os.Getenv("NOVEST_PASSWORD"),
		"downloadMode":    "chapter_range",
		"startChapterUrl": "minh-hoa-22915",
		"endChapterUrl":   "muon-am-tham-ket-noi-cung-dong-hao-ngot-vol-1-ch-1-mo-dau-dieu-muon-lam-khi-lon-len",
	}

	var logs bytes.Buffer
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	createdFiles, warnings, err := svc.RunExtension(ctx, "novest2epub", params, &logs)
	t.Logf("LOGS:\n%s", logs.String())
	if err != nil {
		t.Fatalf("RunExtension failed: %v", err)
	}
	if len(createdFiles) == 0 {
		t.Fatalf("expected created epub files, got 0")
	}
	t.Logf("Created %d EPUB file(s): %v, warnings: %v", len(createdFiles), createdFiles, warnings)

	epubPath := filepath.Join(tmpDir, "edit", createdFiles[0])
	r, err := zip.OpenReader(epubPath)
	if err != nil {
		t.Fatalf("zip.OpenReader failed: %v", err)
	}
	defer r.Close()

	var imageCount int
	for _, f := range r.File {
		if strings.HasPrefix(f.Name, "OEBPS/images/") || strings.HasPrefix(f.Name, "images/") {
			imageCount++
			t.Logf("Embedded image inside EPUB: %s (size: %d bytes)", f.Name, f.UncompressedSize64)
		}
	}
	t.Logf("Novest EPUB verified successfully. Total images: %d, Total files: %d", imageCount, len(r.File))
	if imageCount == 0 {
		t.Fatalf("expected embedded illustration images, got 0")
	}
}



