package service

import (
	"archive/zip"
	"bytes"
	"fmt"
	"image"
	"image/jpeg"
	"image/png"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"epubforge/internal/models"

	"github.com/deepteams/webp"
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

	renameMap := make(map[string]string)
	type BasenameReplacement struct {
		Old string
		New string
	}
	var basenameReplacements []BasenameReplacement
	convertedBytes := make(map[string][]byte)

	if req.ConvertToWebp {
		for name, f := range ctx.Entries {
			if f.FileInfo().IsDir() {
				continue
			}
			if removedPaths[name] {
				continue
			}
			ext := strings.ToLower(filepath.Ext(name))
			if ext == ".jpg" || ext == ".jpeg" || ext == ".png" {
				rc, err := f.Open()
				if err != nil {
					continue
				}
				originalData, err := io.ReadAll(rc)
				_ = rc.Close()
				if err != nil {
					continue
				}
				webpData, err := convertToWebp(originalData, req.ImageQuality)
				if err == nil {
					newExt := ".webp"
					newName := name[:len(name)-len(ext)] + newExt
					renameMap[name] = newName
					convertedBytes[name] = webpData

					oldBase := filepath.Base(name)
					newBase := filepath.Base(newName)
					basenameReplacements = append(basenameReplacements, BasenameReplacement{
						Old: oldBase,
						New: newBase,
					})
				}
			}
		}
		sort.Slice(basenameReplacements, func(i, j int) bool {
			return len(basenameReplacements[i].Old) > len(basenameReplacements[j].Old)
		})
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

		var data []byte
		var readErr error
		targetName := name

		if webpData, ok := convertedBytes[name]; ok {
			data = webpData
			if newPath, ok := renameMap[name]; ok {
				targetName = newPath
			}
		} else {
			rc, err := f.Open()
			if err != nil {
				_ = zw.Close()
				_ = out.Close()
				_ = os.Remove(tmpPath)
				return models.OptimizeResponse{}, err
			}
			data, readErr = io.ReadAll(rc)
			_ = rc.Close()
			if readErr != nil {
				_ = zw.Close()
				_ = out.Close()
				_ = os.Remove(tmpPath)
				return models.OptimizeResponse{}, readErr
			}

			if req.CompressImages {
				data = compressImage(name, data, req.ImageQuality)
			}
		}

		if name == ctx.OPFPath {
			opfStr := cleanAndRenameOPFManifest(string(data), removedPaths, renameMap, ctx.OPFDir)
			for _, repl := range basenameReplacements {
				opfStr = strings.ReplaceAll(opfStr, repl.Old, repl.New)
			}
			data = []byte(opfStr)
		} else {
			ext := strings.ToLower(filepath.Ext(name))
			if ext == ".xhtml" || ext == ".html" || ext == ".htm" || ext == ".css" || ext == ".ncx" {
				txt := string(data)
				if req.CleanHTML && (ext == ".xhtml" || ext == ".html" || ext == ".htm") {
					txt = CleanHTMLContent(txt, req.StripInlineStyles, req.RemoveEmptyLines, req.NormalizeParagraphs, req.RegexFilters)
				}
				for _, repl := range basenameReplacements {
					txt = strings.ReplaceAll(txt, repl.Old, repl.New)
				}
				data = []byte(txt)
			}
		}

		w, err := zw.Create(targetName)
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

	var convertedList []string
	for oldPath := range renameMap {
		convertedList = append(convertedList, oldPath)
	}
	sort.Strings(convertedList)

	return models.OptimizeResponse{
		Success:         true,
		OriginalSize:    ctx.Size,
		NewSize:         newSize,
		RemovedFiles:    removedList,
		ConvertedImages: convertedList,
	}, nil
}

func cleanAndRenameOPFManifest(opfContent string, removedPaths map[string]bool, renameMap map[string]string, opfDir string) string {
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

		if newFullPath, ok := renameMap[fullPath]; ok {
			newHref := newFullPath
			if opfDir != "" && strings.HasPrefix(newFullPath, opfDir) {
				newHref = strings.Replace(newFullPath, opfDir, "", 1)
			}

			id := attrs["id"]
			properties := attrs["properties"]

			var sb strings.Builder
			sb.WriteString(fmt.Sprintf(`<item id="%s" href="%s" media-type="image/webp"`, escapeXML(id), escapeXML(newHref)))
			if properties != "" {
				sb.WriteString(fmt.Sprintf(` properties="%s"`, escapeXML(properties)))
			}
			for k, v := range attrs {
				if k != "id" && k != "href" && k != "media-type" && k != "properties" {
					sb.WriteString(fmt.Sprintf(` %s="%s"`, k, escapeXML(v)))
				}
			}
			sb.WriteString("/>")
			newItems = append(newItems, "    "+sb.String())
		} else {
			newItems = append(newItems, raw)
		}
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

func convertToWebp(originalData []byte, quality int) ([]byte, error) {
	img, _, err := image.Decode(bytes.NewReader(originalData))
	if err != nil {
		return nil, err
	}

	var buf bytes.Buffer
	if quality <= 0 || quality > 100 {
		quality = 75
	}
	err = webp.Encode(&buf, img, &webp.EncoderOptions{
		Quality: float32(quality),
		Method:  4,
	})
	if err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}
