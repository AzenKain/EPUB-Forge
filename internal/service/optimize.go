package service

import (
	"archive/zip"
	"bufio"
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
	"sync"

	"epubforge/internal/models"

	"github.com/deepteams/webp"
)

func (s *Service) Optimize(id string, req models.OptimizeRequest) (models.OptimizeResponse, error) {
	zipMu := getZipWriteLock(id)
	zipMu.Lock()
	defer zipMu.Unlock()

	lock := s.getBookLock(id)
	lock.Lock()
	defer lock.Unlock()

	ctx, err := loadBook(id)
	if err != nil {
		return models.OptimizeResponse{}, err
	}
	defer ctx.Close()

	reachablePaths, reachableContent := ctx.optimizationReachablePaths()

	removedPaths := make(map[string]bool)
	removedList := []string{}

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

		baseName := zipBaseName(name)
		ext := strings.ToLower(filepath.Ext(name))

		isUnusedCandidate := false
		if (ext == ".jpg" || ext == ".jpeg" || ext == ".png" || ext == ".gif" || ext == ".webp") && req.CleanUnusedImages {
			isUnusedCandidate = true
		} else if (ext == ".ttf" || ext == ".otf" || ext == ".woff" || ext == ".woff2") && req.CleanUnusedFonts {
			isUnusedCandidate = true
		}

		if isUnusedCandidate {
			isUsed := reachablePaths[name] || strings.Contains(reachableContent, baseName) || strings.Contains(reachableContent, name)
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
	processedBytes := make(map[string][]byte)

	if req.ConvertToWebp || req.CompressImages {
		type imageTask struct {
			name string
			file *zip.File
			ext  string
		}
		type imageResult struct {
			name      string
			newName   string
			data      []byte
			converted bool
		}

		var tasks []imageTask
		for _, f := range ctx.Reader.File {
			name := f.Name
			if f.FileInfo().IsDir() || removedPaths[name] {
				continue
			}
			ext := strings.ToLower(filepath.Ext(name))
			if ext != ".jpg" && ext != ".jpeg" && ext != ".png" {
				continue
			}
			tasks = append(tasks, imageTask{name: name, file: f, ext: ext})
		}

		if len(tasks) > 0 {
			taskCh := make(chan imageTask)
			resultCh := make(chan imageResult, len(tasks))
			workers := workerCount(len(tasks))
			var wg sync.WaitGroup

			wg.Add(workers)
			for i := 0; i < workers; i++ {
				go func() {
					defer wg.Done()
					for task := range taskCh {
						rc, err := task.file.Open()
						if err != nil {
							continue
						}
						originalData, err := io.ReadAll(rc)
						_ = rc.Close()
						if err != nil {
							continue
						}

						if req.ConvertToWebp {
							if webpData, err := convertToWebp(originalData, req.ImageQuality); err == nil {
								resultCh <- imageResult{
									name:      task.name,
									newName:   task.name[:len(task.name)-len(task.ext)] + ".webp",
									data:      webpData,
									converted: true,
								}
								continue
							}
						}

						if req.CompressImages {
							compressed := compressImage(task.name, originalData, req.ImageQuality)
							if len(compressed) < len(originalData) {
								resultCh <- imageResult{name: task.name, data: compressed}
							}
						}
					}
				}()
			}

			go func() {
				for _, task := range tasks {
					taskCh <- task
				}
				close(taskCh)
				wg.Wait()
				close(resultCh)
			}()

			for result := range resultCh {
				if result.converted {
					renameMap[result.name] = result.newName
					processedBytes[result.name] = result.data

					basenameReplacements = append(basenameReplacements, BasenameReplacement{
						Old: zipBaseName(result.name),
						New: zipBaseName(result.newName),
					})
					continue
				}
				if len(result.data) > 0 {
					processedBytes[result.name] = result.data
				}
			}
		}

		sort.Slice(basenameReplacements, func(i, j int) bool {
			return len(basenameReplacements[i].Old) > len(basenameReplacements[j].Old)
		})
	}

	if err := s.pushUndoSnapshot(id); err != nil {
		return models.OptimizeResponse{}, err
	}
	tmpPath := ctx.FilePath + ".tmp"
	out, err := os.Create(tmpPath)
	if err != nil {
		return models.OptimizeResponse{}, err
	}
	bufOut := bufio.NewWriterSize(out, 2*1024*1024)
	zw := zip.NewWriter(bufOut)
	copyBuf := make([]byte, 1024*1024)
	written := make(map[string]bool)

	writeOptimizedEntry := func(name string, f *zip.File) error {
		if f.FileInfo().IsDir() || removedPaths[name] || written[name] {
			return nil
		}

		targetName := name
		if newPath, ok := renameMap[name]; ok {
			targetName = newPath
		}

		if written[targetName] {
			written[name] = true
			return nil
		}

		canDirectCopy := false
		if _, ok := processedBytes[name]; !ok {
			if _, ok := renameMap[name]; !ok {
				ext := strings.ToLower(filepath.Ext(name))
				if name != ctx.OPFPath &&
					ext != ".xhtml" && ext != ".html" && ext != ".htm" &&
					ext != ".css" && ext != ".ncx" {
					canDirectCopy = true
				}
			}
		}

		if canDirectCopy {
			if err := copyZipEntry(zw, f, copyBuf); err != nil {
				return err
			}
			written[name] = true
			written[targetName] = true
			return nil
		}

		var data []byte
		var readErr error

		if processedData, ok := processedBytes[name]; ok {
			data = processedData
		} else {
			rc, err := f.Open()
			if err != nil {
				return err
			}
			data, readErr = io.ReadAll(rc)
			_ = rc.Close()
			if readErr != nil {
				return readErr
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
				if (req.CleanHTML || req.NormalizeTypography) && (ext == ".xhtml" || ext == ".html" || ext == ".htm") {
					txt = CleanHTMLContent(
						txt,
						req.CleanHTML && req.StripInlineStyles,
						req.CleanHTML && req.RemoveEmptyLines,
						req.CleanHTML && req.NormalizeParagraphs,
						req.RegexFilters,
						req.NormalizeTypography,
						req.SmartQuotes,
						req.NormalizeTones,
						req.FixSpacing,
					)
				}
				for _, repl := range basenameReplacements {
					txt = strings.ReplaceAll(txt, repl.Old, repl.New)
				}
				data = []byte(txt)
			}
		}

		method := uint16(zip.Deflate)
		if targetName == "mimetype" {
			method = zip.Store
		}
		header := &zip.FileHeader{Name: targetName, Method: method}
		header.SetMode(0644)
		w, err := zw.CreateHeader(header)
		if err != nil {
			return err
		}
		if _, err := w.Write(data); err != nil {
			return err
		}
		written[name] = true
		written[targetName] = true
		return nil
	}

	if f := ctx.Entries["mimetype"]; f != nil {
		if err := writeOptimizedEntry("mimetype", f); err != nil {
			_ = zw.Close()
			_ = out.Close()
			_ = os.Remove(tmpPath)
			return models.OptimizeResponse{}, err
		}
	}
	for _, f := range ctx.Reader.File {
		if err := writeOptimizedEntry(f.Name, f); err != nil {
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
	if err := bufOut.Flush(); err != nil {
		_ = out.Close()
		_ = os.Remove(tmpPath)
		return models.OptimizeResponse{}, err
	}
	if err := out.Close(); err != nil {
		_ = os.Remove(tmpPath)
		return models.OptimizeResponse{}, err
	}

	if err := replaceBookFileWithTemp(id, ctx, tmpPath); err != nil {
		return models.OptimizeResponse{}, err
	}

	newInfo, err := os.Stat(ctx.FilePath)
	newSize := ctx.Size
	if err == nil {
		newSize = newInfo.Size()
	}

	convertedList := []string{}
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

func (ctx *BookContext) optimizationReachablePaths() (map[string]bool, string) {
	reachable := make(map[string]bool)
	scanRoots := make(map[string]bool)

	addReachable := func(path string) {
		if strings.TrimSpace(path) == "" {
			return
		}
		path = normalizeZipPath(path)
		if path != "" && path != "." {
			reachable[path] = true
		}
	}
	addScanRoot := func(path string) {
		if strings.TrimSpace(path) == "" {
			return
		}
		path = normalizeZipPath(path)
		if path != "" && path != "." {
			reachable[path] = true
			scanRoots[path] = true
		}
	}

	addReachable("mimetype")
	addReachable(ctx.OPFPath)
	for _, f := range ctx.Reader.File {
		if strings.HasPrefix(f.Name, "META-INF/") {
			addReachable(f.Name)
		}
	}

	for _, ref := range ctx.Spine {
		if item, ok := ctx.ManifestByID[ref.IDRef]; ok {
			addScanRoot(item.FullPath)
		}
	}
	if coverID := ctx.coverID(); coverID != "" {
		if item, ok := ctx.ManifestByID[coverID]; ok {
			addReachable(item.FullPath)
		}
	}
	if ctx.NCX != nil {
		addReachable(ctx.NCX.FullPath)
	}
	for _, item := range ctx.Manifest {
		if hasPropertyToken(item.Attrs["properties"], "nav") {
			addScanRoot(item.FullPath)
		}
	}

	if deps, err := ctx.collectDependencies(scanRoots); err == nil {
		for dep := range deps {
			addReachable(dep)
		}
	}

	var content strings.Builder
	for path := range reachable {
		ext := strings.ToLower(filepath.Ext(path))
		if ext != ".xhtml" && ext != ".html" && ext != ".htm" && ext != ".css" && ext != ".ncx" {
			continue
		}
		if text, err := ctx.readText(path); err == nil {
			content.WriteString(text)
			content.WriteByte('\n')
		}
	}
	return reachable, content.String()
}

func zipBaseName(name string) string {
	name = strings.TrimRight(strings.ReplaceAll(name, "\\", "/"), "/")
	if idx := strings.LastIndex(name, "/"); idx >= 0 {
		return name[idx+1:]
	}
	return name
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

		fullPath := resolveZipHref(opfDir, href)

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
