package service

import (
	"archive/tar"
	"archive/zip"
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"runtime"
	"strings"
	"time"

	"epubforge/internal/models"

	"github.com/Masterminds/semver/v3"
	"github.com/creativeprojects/go-selfupdate/update"
)

type gitHubRelease struct {
	TagName    string `json:"tag_name"`
	Name       string `json:"name"`
	Body       string `json:"body"`
	Prerelease bool   `json:"prerelease"`
	Draft      bool   `json:"draft"`
	Assets     []struct {
		Name               string `json:"name"`
		Size               int64  `json:"size"`
		BrowserDownloadURL string `json:"browser_download_url"`
	} `json:"assets"`
}

func normalizeTagName(tag string) string {
	tag = strings.TrimPrefix(tag, "v")
	parts := strings.Split(tag, ".")
	if len(parts) == 1 {
		return tag + ".0.0"
	}
	if len(parts) == 2 {
		return tag + ".0"
	}
	return tag
}

func fetchLatestRelease(ctx context.Context) (*gitHubRelease, error) {
	req, err := http.NewRequestWithContext(ctx, "GET", "https://api.github.com/repos/AzenKain/EPUB-Forge/releases/latest", nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "EPUB-Forge-SelfUpdate")

	token := os.Getenv("GITHUB_TOKEN")
	if token != "" && !strings.Contains(strings.ToLower(token), "dummy") {
		req.Header.Set("Authorization", "token "+token)
	}

	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("failed to fetch latest release: HTTP status %s", resp.Status)
	}

	var rel gitHubRelease
	if err := json.NewDecoder(resp.Body).Decode(&rel); err != nil {
		return nil, fmt.Errorf("failed to decode release JSON: %w", err)
	}

	return &rel, nil
}

func (s *Service) CheckUpdate(ctx context.Context) (*models.UpdateCheckResponse, error) {
	rel, err := fetchLatestRelease(ctx)
	if err != nil {
		return nil, err
	}

	currNorm := normalizeTagName(s.version)
	latestNorm := normalizeTagName(rel.TagName)

	currSem, err := semver.NewVersion(currNorm)
	if err != nil {
		return nil, fmt.Errorf("invalid current version semver format (%s): %w", s.version, err)
	}
	latestSem, err := semver.NewVersion(latestNorm)
	if err != nil {
		return nil, fmt.Errorf("invalid latest version semver format (%s): %w", rel.TagName, err)
	}

	available := latestSem.GreaterThan(currSem)

	var assetName string
	var assetSize int64
	var found bool

	goos := runtime.GOOS
	goarch := runtime.GOARCH

	for _, asset := range rel.Assets {
		aName := strings.ToLower(asset.Name)
		if strings.Contains(aName, strings.ToLower(goos)) && strings.Contains(aName, strings.ToLower(goarch)) {
			assetName = asset.Name
			assetSize = asset.Size
			found = true
			break
		}
	}

	if !found {
		available = false
	}

	return &models.UpdateCheckResponse{
		CurrentVersion:  s.version,
		LatestVersion:   rel.TagName,
		UpdateAvailable: available,
		ReleaseNotes:    rel.Body,
		AssetName:       assetName,
		AssetSize:       assetSize,
	}, nil
}

func (s *Service) RunUpdate() error {
	s.updateMu.Lock()
	if s.updateStatus == "downloading" || s.updateStatus == "applying" {
		s.updateMu.Unlock()
		return errors.New("update is already in progress")
	}
	s.updateStatus = "downloading"
	s.updatePercent = 0
	s.updateErr = ""
	s.updateMu.Unlock()

	go func() {
		err := s.doUpdate(context.Background())
		s.updateMu.Lock()
		defer s.updateMu.Unlock()
		if err != nil {
			s.updateStatus = "error"
			s.updateErr = err.Error()
		} else {
			s.updateStatus = "completed"
			s.updatePercent = 100
		}
	}()

	return nil
}

func (s *Service) GetUpdateProgress() *models.UpdateProgressResponse {
	s.updateMu.Lock()
	defer s.updateMu.Unlock()
	return &models.UpdateProgressResponse{
		Status:  s.updateStatus,
		Percent: s.updatePercent,
		Error:   s.updateErr,
	}
}

func (s *Service) doUpdate(ctx context.Context) error {
	rel, err := fetchLatestRelease(ctx)
	if err != nil {
		return err
	}

	var assetName string
	var assetURL string
	var assetSize int64
	var found bool

	goos := runtime.GOOS
	goarch := runtime.GOARCH

	for _, asset := range rel.Assets {
		aName := strings.ToLower(asset.Name)
		if strings.Contains(aName, strings.ToLower(goos)) && strings.Contains(aName, strings.ToLower(goarch)) {
			assetName = asset.Name
			assetURL = asset.BrowserDownloadURL
			assetSize = asset.Size
			found = true
			break
		}
	}

	if !found {
		return fmt.Errorf("no matching release asset found for platform %s/%s", goos, goarch)
	}

	req, err := http.NewRequestWithContext(ctx, "GET", assetURL, nil)
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", "EPUB-Forge-SelfUpdate")

	token := os.Getenv("GITHUB_TOKEN")
	if token != "" && !strings.Contains(strings.ToLower(token), "dummy") {
		req.Header.Set("Authorization", "token "+token)
	}

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("failed to download update: HTTP status %s", resp.Status)
	}

	totalBytes := resp.ContentLength
	if totalBytes <= 0 {
		totalBytes = assetSize
	}

	var buf bytes.Buffer
	buffer := make([]byte, 32*1024)
	var readBytes int64

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		n, err := resp.Body.Read(buffer)
		if n > 0 {
			buf.Write(buffer[:n])
			readBytes += int64(n)
			if totalBytes > 0 {
				s.updateMu.Lock()
				s.updatePercent = int((readBytes * 100) / totalBytes)
				if s.updatePercent > 99 {
					s.updatePercent = 99
				}
				s.updateMu.Unlock()
			}
		}
		if err == io.EOF {
			break
		}
		if err != nil {
			return err
		}
	}

	s.updateMu.Lock()
	s.updateStatus = "applying"
	s.updatePercent = 99
	s.updateMu.Unlock()

	var binReader io.Reader = &buf

	nameLower := strings.ToLower(assetName)
	if strings.HasSuffix(nameLower, ".zip") {
		zipReader, err := zip.NewReader(bytes.NewReader(buf.Bytes()), int64(buf.Len()))
		if err != nil {
			return fmt.Errorf("failed to parse zip archive: %w", err)
		}
		var targetFile *zip.File
		for _, f := range zipReader.File {
			if f.FileInfo().IsDir() {
				continue
			}
			fName := strings.ToLower(f.Name)
			if strings.Contains(fName, "epubforge") || len(zipReader.File) == 1 {
				targetFile = f
				break
			}
		}
		if targetFile == nil && len(zipReader.File) > 0 {
			targetFile = zipReader.File[0]
		}
		if targetFile == nil {
			return errors.New("no files found in zip archive")
		}

		rc, err := targetFile.Open()
		if err != nil {
			return fmt.Errorf("failed to open zip file member: %w", err)
		}
		defer rc.Close()

		var unpacked bytes.Buffer
		if _, err := io.Copy(&unpacked, rc); err != nil {
			return fmt.Errorf("failed to decompress zip file member: %w", err)
		}
		binReader = &unpacked

	} else if strings.HasSuffix(nameLower, ".tar.gz") || strings.HasSuffix(nameLower, ".tgz") {
		gr, err := gzip.NewReader(bytes.NewReader(buf.Bytes()))
		if err != nil {
			return fmt.Errorf("failed to create gzip reader: %w", err)
		}
		defer gr.Close()

		tr := tar.NewReader(gr)
		var unpacked bytes.Buffer
		foundBin := false
		for {
			hdr, err := tr.Next()
			if err == io.EOF {
				break
			}
			if err != nil {
				return fmt.Errorf("failed to read tar archive: %w", err)
			}
			if hdr.Typeflag == tar.TypeReg {
				fName := strings.ToLower(hdr.Name)
				if strings.Contains(fName, "epubforge") || !foundBin {
					unpacked.Reset()
					if _, err := io.Copy(&unpacked, tr); err != nil {
						return fmt.Errorf("failed to extract file from tar: %w", err)
					}
					foundBin = true
					if strings.Contains(fName, "epubforge") {
						break
					}
				}
			}
		}
		if !foundBin {
			return errors.New("no files found in tar archive")
		}
		binReader = &unpacked
	}

	err = update.Apply(binReader, update.Options{})
	if err != nil {
		return fmt.Errorf("failed to apply update: %w", err)
	}

	return nil
}

func (s *Service) RestartApp() {
	self, err := os.Executable()
	if err != nil {
		os.Exit(0)
		return
	}

	cmd := exec.Command(self)
	cmd.Args = os.Args

	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	cmd.Stdin = nil

	_ = cmd.Start()
	os.Exit(0)
}
