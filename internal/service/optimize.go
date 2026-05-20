package service

import (
	"archive/zip"
	"bytes"
	"image"
	"image/jpeg"
	"image/png"
	"io"
	"os"
	"path/filepath"
	"strings"

	"epubforge/internal/models"
)

func (s *Service) Optimize(id string, req models.OptimizeRequest) (models.OptimizeResponse, error) {
	lock := s.getBookLock(id)
	lock.Lock()
	defer lock.Unlock()

	ctx, err := loadBook(id)
	if err != nil {
		return models.OptimizeResponse{}, err
	}
	defer ctx.Close()

	var combinedContentBuilder strings.Builder
	for _, item := range ctx.Manifest {
		ext := strings.ToLower(filepath.Ext(item.FullPath))
		if ext == ".xhtml" || ext == ".html" || ext == ".htm" || ext == ".css" {
			if content, err := ctx.readText(item.FullPath); err == nil {
				combinedContentBuilder.WriteString(content)
				combinedContentBuilder.WriteString("\n")
			}
		}
	}
	combinedContent := combinedContentBuilder.String()

	coverPath := ""
	if coverID := ctx.coverID(); coverID != "" {
		if item, ok := ctx.ManifestByID[coverID]; ok {
			coverPath = item.FullPath
		}
	}

	removedPaths := make(map[string]bool)
	var removedList []string

	for name, f := range ctx.Entries {
		if f.FileInfo().IsDir() {
			continue
		}

		lowerName := strings.ToLower(name)
		if name == "mimetype" ||
			name == "META-INF/container.xml" ||
			name == ctx.OPFPath ||
			lowerName == "toc.ncx" ||
			strings.HasSuffix(lowerName, ".opf") ||
			strings.HasSuffix(lowerName, ".ncx") {
			continue
		}

		if strings.HasSuffix(lowerName, ".xhtml") ||
			strings.HasSuffix(lowerName, ".html") ||
			strings.HasSuffix(lowerName, ".htm") ||
			strings.HasSuffix(lowerName, ".css") {
			continue
		}

		if coverPath != "" && name == coverPath {
			continue
		}

		baseName := filepath.Base(name)
		ext := strings.ToLower(filepath.Ext(name))

		isUnusedCandidate := false
		if (ext == ".jpg" || ext == ".jpeg" || ext == ".png" || ext == ".gif" || ext == ".webp") && req.CleanUnusedImages {
			isUnusedCandidate = true
		} else if (ext == ".ttf" || ext == ".otf" || ext == ".woff" || ext == ".woff2") && req.CleanUnusedFonts {
			isUnusedCandidate = true
		}

		if isUnusedCandidate {
			isUsed := strings.Contains(combinedContent, baseName) || strings.Contains(combinedContent, name)
			if !isUsed {
				removedPaths[name] = true
				removedList = append(removedList, name)
			}
		}
	}

	tmpPath := ctx.FilePath + ".tmp"
	out, err := os.Create(tmpPath)
	if err != nil {
		return models.OptimizeResponse{}, err
	}
	zw := zip.NewWriter(out)

	for name, f := range ctx.Entries {
		if f.FileInfo().IsDir() {
			continue
		}

		if removedPaths[name] {
			continue
		}

		rc, err := f.Open()
		if err != nil {
			_ = zw.Close()
			_ = out.Close()
			_ = os.Remove(tmpPath)
			return models.OptimizeResponse{}, err
		}
		data, err := io.ReadAll(rc)
		_ = rc.Close()
		if err != nil {
			_ = zw.Close()
			_ = out.Close()
			_ = os.Remove(tmpPath)
			return models.OptimizeResponse{}, err
		}

		if name == ctx.OPFPath {
			opfStr := cleanOPFManifest(string(data), removedPaths, ctx.OPFDir)
			data = []byte(opfStr)
		} else if req.CompressImages {

			data = compressImage(name, data, req.ImageQuality)
		}

		w, err := zw.Create(name)
		if err != nil {
			_ = zw.Close()
			_ = out.Close()
			_ = os.Remove(tmpPath)
			return models.OptimizeResponse{}, err
		}
		_, err = w.Write(data)
		if err != nil {
			_ = zw.Close()
			_ = out.Close()
			_ = os.Remove(tmpPath)
			return models.OptimizeResponse{}, err
		}
	}

	if err := zw.Close(); err != nil {
		_ = out.Close()
		_ = os.Remove(tmpPath)
		return models.OptimizeResponse{}, err
	}
	_ = out.Close()

	ctx.Close()

	if err := os.Rename(tmpPath, ctx.FilePath); err != nil {
		_ = os.Remove(tmpPath)
		return models.OptimizeResponse{}, err
	}

	newInfo, err := os.Stat(ctx.FilePath)
	newSize := ctx.Size
	if err == nil {
		newSize = newInfo.Size()
	}

	return models.OptimizeResponse{
		Success:      true,
		OriginalSize: ctx.Size,
		NewSize:      newSize,
		RemovedFiles: removedList,
	}, nil
}

func cleanOPFManifest(opfContent string, removedPaths map[string]bool, opfDir string) string {
	manifestMatch := manifestRe.FindStringSubmatch(opfContent)
	if len(manifestMatch) < 4 {
		return opfContent
	}
	manifestHeader := manifestMatch[1]
	manifestBody := manifestMatch[2]
	manifestFooter := manifestMatch[3]

	items := itemRe.FindAllString(manifestBody, -1)
	var newItems []string
	for _, raw := range items {
		attrs := parseAttrs(raw)
		href := attrs["href"]

		fullPath := href
		if opfDir != "" {
			fullPath = opfDir + href
		}

		if removedPaths[fullPath] {
			continue
		}
		newItems = append(newItems, raw)
	}

	newManifestBody := strings.Join(newItems, "\n")
	return strings.Replace(opfContent, manifestMatch[0], manifestHeader+newManifestBody+manifestFooter, 1)
}

func compressImage(name string, originalData []byte, quality int) []byte {
	ext := strings.ToLower(filepath.Ext(name))
	if ext != ".jpg" && ext != ".jpeg" && ext != ".png" {
		return originalData
	}

	img, _, err := image.Decode(bytes.NewReader(originalData))
	if err != nil {
		return originalData
	}

	var buf bytes.Buffer
	switch ext {
	case ".jpg", ".jpeg":
		if quality <= 0 || quality > 100 {
			quality = 75
		}
		err = jpeg.Encode(&buf, img, &jpeg.Options{Quality: quality})
	case ".png":
		enc := png.Encoder{CompressionLevel: png.BestCompression}
		err = enc.Encode(&buf, img)
	}

	if err == nil && buf.Len() < len(originalData) {
		return buf.Bytes()
	}
	return originalData
}
