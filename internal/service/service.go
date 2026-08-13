package service

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/xml"
	"errors"
	"html"
	"image"
	_ "image/gif"
	"image/jpeg"
	"image/png"
	"io"
	"mime"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"

	"epubforge/internal/models"
	"github.com/go-rod/rod"
	"github.com/go-rod/rod/lib/launcher"
)

type EpubFile = models.EpubFile
type Chapter = models.Chapter
type DetectedVolume = models.DetectedVolume
type BookAnalysis = models.BookAnalysis
type BookMetadata = models.BookMetadata
type ExportRange = models.ExportRange
type ExportRequest = models.ExportRequest
type ExportedFile = models.ExportedFile
type ChapterEditRequest = models.ChapterEditRequest
type ImportTxtRequest = models.ImportTxtRequest
type OptimizeResponse = models.OptimizeResponse

type volumeStart struct {
	label      string
	reason     string
	confidence string
	index      int
}

type ActiveRun struct {
	Page      *rod.Page
	SessionID string
	Cancel    context.CancelFunc
	Mu        sync.Mutex

	ChoiceMu sync.Mutex
	ChoiceID string
	ChoiceCh chan []string
}

var (
	workspace            string
	editDir              string
	outputRoot           string
	undoDir              string
	itemRe               = regexp.MustCompile(`(?is)<item\b[^>]*/>`)
	itemrefRe            = regexp.MustCompile(`(?is)<itemref\b[^>]*/?>`)
	manifestRe           = regexp.MustCompile(`(?is)(<manifest\b[^>]*>)(.*?)(</manifest>)`)
	spineRe              = regexp.MustCompile(`(?is)(<spine\b[^>]*>)(.*?)(</spine>)`)
	attrRe               = regexp.MustCompile(`([\w:.-]+)\s*=\s*["']([^"']*)["']`)
	metadataRe           = regexp.MustCompile(`(?is)(<metadata\b[^>]*>)(.*?)(</metadata>)`)
	titleRe              = regexp.MustCompile(`(?is)<dc:title\b[^>]*>.*?</dc:title>`)
	titleTextRe          = regexp.MustCompile(`(?is)<dc:title\b[^>]*>(.*?)</dc:title>`)
	creatorTextRe        = regexp.MustCompile(`(?is)<dc:creator\b[^>]*>(.*?)</dc:creator>`)
	languageTextRe       = regexp.MustCompile(`(?is)<dc:language\b[^>]*>(.*?)</dc:language>`)
	publisherTextRe      = regexp.MustCompile(`(?is)<dc:publisher\b[^>]*>(.*?)</dc:publisher>`)
	descriptionTextRe    = regexp.MustCompile(`(?is)<dc:description\b[^>]*>(.*?)</dc:description>`)
	subjectTextRe        = regexp.MustCompile(`(?is)<dc:subject\b[^>]*>(.*?)</dc:subject>`)
	htmlTitleRe          = regexp.MustCompile(`(?is)<h[1-6]\b[^>]*>(.*?)</h[1-6]>|<title\b[^>]*>(.*?)</title>`)
	srcRe                = regexp.MustCompile(`(?is)\s(?:src|poster)\s*=\s*["']([^"']+)["']`)
	srcsetRe             = regexp.MustCompile(`(?is)\ssrcset\s*=\s*["']([^"']+)["']`)
	linkRe               = regexp.MustCompile(`(?is)<link\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>`)
	cssURLRe             = regexp.MustCompile(`(?is)url\(([^)]+)\)`)
	volumeRe             = regexp.MustCompile(`(?i)\b(vol(?:ume)?\.?\s*0*\d{1,3}(?:\s*\([^)]*\))?|\btập\s*0*\d{1,3}\b|\bquyển\s*0*\d{1,3}\b)`)
	structureNumberRe    = regexp.MustCompile(`(?i)\b(?:ch(?:apter)?\.?|chương|chuong|chap\.?|part|phần|phan|section|episode|ep\.?|arc|act|book)\s*[:#.\-–—]?\s*0*(\d{1,4})\b`)
	volumeHeaderRe       = regexp.MustCompile(`(?is)<header\b[^>]*\bid\s*=\s*["']volume_[^"']*["'][^>]*>.*?</header>`)
	volumeHeaderAnchorRe = regexp.MustCompile(`(?is)<a\b[^>]*\bhref\s*=\s*["']([^"']*)["'][^>]*>(.*?)</a>`)
	hrefAttrRe           = regexp.MustCompile(`(?is)<a\b[^>]*\bhref\s*=\s*["']([^"']+)["']`)
)

type Service struct {
	bookMu       sync.Mutex
	locks        map[string]*sync.Mutex
	undoMu       sync.Mutex
	undoStacks   map[string][]string
	browser      *rod.Browser
	launcher     *launcher.Launcher
	activeRuns   map[string]*ActiveRun
	activeRunsMu sync.RWMutex

	version       string
	updateMu      sync.Mutex
	updateStatus  string
	updatePercent int
	updateErr     string
}

func New(workspaceDir string, version string) (*Service, error) {
	workspace = workspaceDir
	editDir = filepath.Join(workspace, "edit")
	if err := os.MkdirAll(editDir, 0755); err != nil {
		return nil, err
	}

	if entries, err := os.ReadDir(editDir); err == nil {
		for _, entry := range entries {
			if !entry.IsDir() && strings.HasSuffix(entry.Name(), ".tmp") {
				_ = os.Remove(filepath.Join(editDir, entry.Name()))
			}
		}
	}
	outputRoot = filepath.Join(workspace, "output")
	if err := os.MkdirAll(outputRoot, 0755); err != nil {
		return nil, err
	}
	undoDir = filepath.Join(workspace, ".undo")
	_ = os.RemoveAll(undoDir)
	if err := os.MkdirAll(undoDir, 0755); err != nil {
		return nil, err
	}
	s := &Service{
		locks:        make(map[string]*sync.Mutex),
		undoStacks:   make(map[string][]string),
		activeRuns:   make(map[string]*ActiveRun),
		version:      version,
		updateStatus: "idle",
	}
	if err := s.EnsureExtensionWorkspace(); err != nil {
		return nil, err
	}
	go s.StartBackgroundWriter()
	return s, nil
}

func (s *Service) getBookLock(id string) *sync.Mutex {
	s.bookMu.Lock()
	defer s.bookMu.Unlock()
	if s.locks == nil {
		s.locks = make(map[string]*sync.Mutex)
	}
	lock, ok := s.locks[id]
	if !ok {
		lock = &sync.Mutex{}
		s.locks[id] = lock
	}
	return lock
}

func (s *Service) OutputFile(relativePath string) (string, string, error) {
	full := filepath.Clean(filepath.Join(outputRoot, filepath.FromSlash(relativePath)))
	root := filepath.Clean(outputRoot)
	if full != root && !strings.HasPrefix(full, root+string(os.PathSeparator)) {
		return "", "", errors.New("invalid output path")
	}
	if _, err := os.Stat(full); err != nil {
		return "", "", err
	}
	return full, filepath.Base(full), nil
}

func cleanText(input string) string {
	return strings.Join(strings.Fields(html.UnescapeString(input)), " ")
}

func cleanDescription(input string) string {
	unescaped := html.UnescapeString(input)
	stripped := stripTags(unescaped)

	reSpaces := regexp.MustCompile(`[ \t]+`)
	lines := strings.Split(stripped, "\n")
	for i, line := range lines {
		lines[i] = strings.TrimSpace(reSpaces.ReplaceAllString(line, " "))
	}

	return strings.TrimSpace(strings.Join(lines, "\n"))
}

func stripTags(input string) string {
	return regexp.MustCompile(`(?is)<[^>]+>`).ReplaceAllString(input, " ")
}

func sanitizeFileName(input string) string {
	return sanitizeFileNameLimit(input, 120)
}

func sanitizeFileNameLimit(input string, maxRunes int) string {
	clean := regexp.MustCompile(`[<>:"/\\|?*\x00-\x1f]+`).ReplaceAllString(input, " ")
	clean = strings.Join(strings.Fields(clean), " ")
	clean = strings.Trim(clean, " .")
	if clean == "" {
		clean = "epub"
	}
	if maxRunes > 0 {
		runes := []rune(clean)
		if len(runes) > maxRunes {
			clean = strings.Trim(string(runes[:maxRunes]), " .")
			if clean == "" {
				clean = "epub"
			}
		}
	}
	base := strings.TrimSuffix(clean, filepath.Ext(clean))
	switch strings.ToUpper(base) {
	case "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9":
		clean = "_" + clean
	}
	return clean
}

func escapeXML(input string) string {
	var b bytes.Buffer
	_ = xml.EscapeText(&b, []byte(input))
	return b.String()
}

func randomID() string {
	var b [16]byte
	_, _ = rand.Read(b[:])
	return hex.EncodeToString(b[:])
}

func contentTypeFor(name string) string {
	ext := strings.ToLower(filepath.Ext(name))
	switch ext {
	case ".xhtml", ".html", ".htm":
		return "application/xhtml+xml"
	case ".css":
		return "text/css"
	case ".ncx":
		return "application/x-dtbncx+xml"
	case ".opf":
		return "application/oebps-package+xml"
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".png":
		return "image/png"
	case ".gif":
		return "image/gif"
	case ".svg":
		return "image/svg+xml"
	case ".ttf":
		return "application/x-font-ttf"
	case ".otf":
		return "application/x-font-opentype"
	case ".woff":
		return "font/woff"
	case ".woff2":
		return "font/woff2"
	}
	if ct := mime.TypeByExtension(ext); ct != "" {
		return ct
	}
	return "application/octet-stream"
}

func parseBase64Image(dataURI string) ([]byte, string, error) {
	if !strings.HasPrefix(dataURI, "data:image/") {
		return nil, "", errors.New("invalid image data prefix")
	}
	parts := strings.SplitN(dataURI, ";base64,", 2)
	if len(parts) != 2 {
		return nil, "", errors.New("invalid base64 image data")
	}
	mimeType := strings.TrimPrefix(parts[0], "data:")
	data, err := base64.StdEncoding.DecodeString(parts[1])
	return data, mimeType, err
}

func convertImage(srcBytes []byte, targetMime string) ([]byte, error) {
	img, _, err := image.Decode(bytes.NewReader(srcBytes))
	if err != nil {
		return nil, err
	}
	var buf bytes.Buffer
	if targetMime == "image/png" {
		err = png.Encode(&buf, img)
	} else {
		err = jpeg.Encode(&buf, img, &jpeg.Options{Quality: 90})
	}
	if err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

func posixDir(p string) string {
	dir := filepath.ToSlash(filepath.Dir(p))
	if dir == "." {
		return ""
	}
	return dir + "/"
}

func isExternalRef(ref string) bool {
	lower := strings.ToLower(ref)
	return strings.HasPrefix(lower, "http://") ||
		strings.HasPrefix(lower, "https://") ||
		strings.HasPrefix(lower, "mailto:") ||
		strings.HasPrefix(lower, "tel:") ||
		strings.HasPrefix(lower, "data:")
}

func normalizeZipPath(p string) string {
	return filepath.ToSlash(filepath.Clean(p))
}

func resolveZipHref(baseDir, href string) string {
	if isExternalRef(href) {
		return ""
	}
	u, err := url.Parse(href)
	if err != nil {
		return ""
	}
	cleanPath := u.Path
	if cleanPath == "" {
		return ""
	}
	var resolved string
	if strings.HasPrefix(cleanPath, "/") {
		resolved = cleanPath[1:]
	} else {
		resolved = filepath.Join(baseDir, cleanPath)
	}
	return normalizeZipPath(resolved)
}

func replaceXMLBlock(re *regexp.Regexp, source, newBlock string) string {
	m := re.FindStringSubmatchIndex(source)
	if len(m) < 8 {
		return source
	}
	return source[:m[4]] + "\n" + newBlock + "\n" + source[m[5]:]
}

func firstSubmatch(re *regexp.Regexp, source string) string {
	m := re.FindStringSubmatch(source)
	if len(m) < 2 {
		return ""
	}
	return m[1]
}

func firstBlock(re *regexp.Regexp, source string) string {
	m := re.FindStringSubmatch(source)
	if len(m) < 3 {
		return ""
	}
	return m[2]
}

func parseAttrs(tag string) map[string]string {
	attrs := make(map[string]string)
	for _, m := range attrRe.FindAllStringSubmatch(tag, -1) {
		if len(m) == 3 {
			attrs[m[1]] = m[2]
		}
	}
	return attrs
}

func findMatchingClosingTag(xmlStr string, startIdx int, openTag, closeTag string) int {
	depth := 0
	i := startIdx
	openLen := len(openTag)
	closeLen := len(closeTag)
	lowerXML := strings.ToLower(xmlStr)

	for i < len(lowerXML) {
		if strings.HasPrefix(lowerXML[i:], openTag) {
			depth++
			i += openLen
		} else if strings.HasPrefix(lowerXML[i:], closeTag) {
			depth--
			if depth == 0 {
				return i + closeLen
			}
			i += closeLen
		} else {
			i++
		}
	}
	return -1
}

func (s *Service) ListEpubs() ([]EpubFile, error) {
	var list []EpubFile
	entries, err := os.ReadDir(editDir)
	if err != nil {
		return nil, err
	}
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		name := entry.Name()
		if !strings.HasSuffix(strings.ToLower(name), ".epub") {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			continue
		}
		list = append(list, EpubFile{
			ID:   toID(name),
			Name: name,
			Size: info.Size(),
		})
	}
	sort.Slice(list, func(i, j int) bool {
		return strings.ToLower(list[i].Name) < strings.ToLower(list[j].Name)
	})
	return list, nil
}

func (s *Service) Analyze(id string) (BookAnalysis, error) {
	lock := s.getBookLock(id)
	lock.Lock()
	defer lock.Unlock()

	ctx, err := loadBook(id)
	if err != nil {
		return BookAnalysis{}, err
	}
	defer ctx.Close()
	return ctx.Analysis(), nil
}

func (s *Service) Asset(id, assetPath string) ([]byte, string, error) {
	lock := s.getBookLock(id)
	lock.Lock()
	defer lock.Unlock()

	ctx, err := loadBook(id)
	if err != nil {
		return nil, "", err
	}
	defer ctx.Close()

	fullPath := resolveZipHref(ctx.OPFDir, assetPath)
	f, ok := ctx.Entries[fullPath]
	if !ok {
		f, ok = ctx.Entries[assetPath]
		if !ok {
			return nil, "", errors.New("asset not found")
		}
	}

	data, err := readZipFile(f)
	if err != nil {
		return nil, "", err
	}

	contentType := mime.TypeByExtension(filepath.Ext(f.Name))
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	return data, contentType, nil
}

func (s *Service) SaveMetadata(id string, metadata models.BookMetadata) (models.BookMetadata, error) {
	zipMu := getZipWriteLock(id)
	zipMu.Lock()
	defer zipMu.Unlock()

	lock := s.getBookLock(id)
	lock.Lock()
	defer lock.Unlock()

	ctx, err := loadBook(id)
	if err != nil {
		return models.BookMetadata{}, err
	}
	defer ctx.Close()

	normalized := normalizeMetadata(metadata, ctx.Metadata)
	if err := s.pushUndoSnapshot(id); err != nil {
		return models.BookMetadata{}, err
	}
	err = ctx.SaveOriginalMetadata(normalized)
	if err != nil {
		return models.BookMetadata{}, err
	}
	return normalized, nil
}

func (s *Service) UploadEpub(filename string, data []byte) (string, error) {
	filename = sanitizeFileName(filename)
	if !strings.HasSuffix(strings.ToLower(filename), ".epub") {
		filename += ".epub"
	}
	filePath := filepath.Join(editDir, filename)
	err := os.WriteFile(filePath, data, 0644)
	if err != nil {
		return "", err
	}
	return filename, nil
}

func (s *Service) DeleteEpub(id string) error {
	lock := s.getBookLock(id)
	lock.Lock()
	defer lock.Unlock()

	name, err := fromID(id)
	if err != nil {
		return err
	}
	filePath := filepath.Join(editDir, name)

	pendingJobsMu.Lock()
	delete(pendingJobs, id)
	delete(pendingPaths, id)
	pendingJobsMu.Unlock()

	zipReaderCacheMu.Lock()
	if cVal, ok := zipReaderCache[id]; ok {
		_ = cVal.reader.Close()
		delete(zipReaderCache, id)
	}
	zipReaderCacheMu.Unlock()

	bookCacheMu.Lock()
	for k := range bookCache {
		if k.path == filePath {
			delete(bookCache, k)
		}
	}
	bookCacheMu.Unlock()

	overlayVersionsMu.Lock()
	delete(overlayVersions, id)
	delete(overlayStructureVersions, id)
	overlayVersionsMu.Unlock()

	lastZippedMu.Lock()
	delete(lastZipped, id)
	lastZippedMu.Unlock()

	zipWriteLocksMu.Lock()
	delete(zipWriteLocks, id)
	zipWriteLocksMu.Unlock()

	overlayDir := filepath.Join(editDir, ".overlay", id)
	_ = os.RemoveAll(overlayDir)

	s.bookMu.Lock()
	if s.locks != nil {
		delete(s.locks, id)
	}
	s.bookMu.Unlock()

	err = removeFileWithRetry(filePath)
	if err != nil && !os.IsNotExist(err) {
		return err
	}

	s.clearUndoStack(id)
	_ = removeFileWithRetry(filePath + ".bak")
	_ = removeFileWithRetry(filePath + ".tmp")
	return nil
}

func (s *Service) RenameEpub(id string, newName string) (EpubFile, error) {
	lock := s.getBookLock(id)
	lock.Lock()
	defer lock.Unlock()

	oldName, err := fromID(id)
	if err != nil {
		return EpubFile{}, err
	}

	newName = strings.TrimSpace(newName)
	if newName == "" {
		return EpubFile{}, errors.New("new EPUB name is required")
	}
	if !strings.HasSuffix(strings.ToLower(newName), ".epub") {
		newName += ".epub"
	}
	newName = sanitizeFileName(newName)
	if !strings.HasSuffix(strings.ToLower(newName), ".epub") {
		newName += ".epub"
	}
	if newName == ".epub" {
		return EpubFile{}, errors.New("invalid EPUB name")
	}

	oldPath := filepath.Join(editDir, oldName)
	newPath := filepath.Join(editDir, newName)
	newID := toID(newName)

	if oldName != newName {
		if !strings.EqualFold(oldPath, newPath) {
			if _, err := os.Stat(newPath); err == nil {
				return EpubFile{}, errors.New("target EPUB already exists")
			} else if !os.IsNotExist(err) {
				return EpubFile{}, err
			}
		}

		pendingJobsMu.Lock()
		isPending := pendingJobs[id]
		pendingJobsMu.Unlock()
		if isPending {
			_ = s.consolidateZIP(id, oldPath)
		}

		zipReaderCacheMu.Lock()
		if cVal, ok := zipReaderCache[id]; ok {
			_ = cVal.reader.Close()
			delete(zipReaderCache, id)
		}
		zipReaderCacheMu.Unlock()

		bookCacheMu.Lock()
		for k := range bookCache {
			if k.path == oldPath {
				delete(bookCache, k)
			}
		}
		bookCacheMu.Unlock()

		oldOverlay := filepath.Join(editDir, ".overlay", id)
		newOverlay := filepath.Join(editDir, ".overlay", newID)
		if _, err := os.Stat(oldOverlay); err == nil {
			_ = renameFileWithRetry(oldOverlay, newOverlay)
		}

		overlayVersionsMu.Lock()
		if v, ok := overlayVersions[id]; ok {
			overlayVersions[newID] = v
			delete(overlayVersions, id)
		}
		if sv, ok := overlayStructureVersions[id]; ok {
			overlayStructureVersions[newID] = sv
			delete(overlayStructureVersions, id)
		}
		overlayVersionsMu.Unlock()

		lastZippedMu.Lock()
		if lz, ok := lastZipped[id]; ok {
			lastZipped[newID] = lz
			delete(lastZipped, id)
		}
		lastZippedMu.Unlock()

		if err := renameFileWithRetry(oldPath, newPath); err != nil {
			return EpubFile{}, err
		}
		_ = removeFileWithRetry(oldPath + ".tmp")
		_ = renameFileWithRetry(oldPath+".bak", newPath+".bak")
	}

	info, err := os.Stat(newPath)
	if err != nil {
		return EpubFile{}, err
	}

	s.bookMu.Lock()
	if s.locks != nil {
		delete(s.locks, id)
	}
	s.bookMu.Unlock()

	if id != newID {
		s.moveUndoStack(id, newID)
	}

	return EpubFile{
		ID:   newID,
		Name: newName,
		Size: info.Size(),
	}, nil
}

func removeFileWithRetry(path string) error {
	var err error
	for i := 0; i < 5; i++ {
		err = os.Remove(path)
		if err == nil || os.IsNotExist(err) {
			return nil
		}
		time.Sleep(100 * time.Millisecond)
	}
	return err
}

func renameFileWithRetry(oldPath, newPath string) error {
	var err error
	for i := 0; i < 5; i++ {
		err = os.Rename(oldPath, newPath)
		if err == nil {
			return nil
		}
		time.Sleep(100 * time.Millisecond)
	}
	return err
}

func (s *Service) UndoStatus(id string) (models.UndoStatus, error) {
	if _, err := fromID(id); err != nil {
		return models.UndoStatus{}, err
	}
	s.undoMu.Lock()
	defer s.undoMu.Unlock()
	count := len(s.undoStacks[id])
	return models.UndoStatus{CanUndo: count > 0, Count: count}, nil
}

func (s *Service) Undo(id string) (BookAnalysis, error) {
	lock := s.getBookLock(id)
	lock.Lock()
	defer lock.Unlock()

	name, err := fromID(id)
	if err != nil {
		return BookAnalysis{}, err
	}
	filePath := filepath.Join(editDir, name)

	snapshotPath, err := s.peekUndoSnapshot(id)
	if err != nil {
		return BookAnalysis{}, err
	}

	tmp := filePath + ".undo.tmp"
	if err := copyFile(snapshotPath, tmp); err != nil {
		_ = os.Remove(tmp)
		return BookAnalysis{}, err
	}
	if err := os.Remove(filePath); err != nil && !os.IsNotExist(err) {
		_ = os.Remove(tmp)
		return BookAnalysis{}, err
	}
	if err := os.Rename(tmp, filePath); err != nil {
		_ = os.Remove(tmp)
		return BookAnalysis{}, err
	}
	s.popUndoSnapshot(id, snapshotPath)

	ctx, err := loadBook(id)
	if err != nil {
		return BookAnalysis{}, err
	}
	defer ctx.Close()
	return ctx.Analysis(), nil
}

const maxUndoSnapshotsPerBook = 20

func (s *Service) pushUndoSnapshot(id string) error {

	return nil

	name, err := fromID(id)
	if err != nil {
		return err
	}
	filePath := filepath.Join(editDir, name)
	if _, err := os.Stat(filePath); err != nil {
		return err
	}
	if err := os.MkdirAll(undoDir, 0755); err != nil {
		return err
	}

	snapshotName := sanitizeFileNameLimit(strings.TrimSuffix(name, filepath.Ext(name)), 80) + "-" + randomID() + ".epub"
	snapshotPath := filepath.Join(undoDir, snapshotName)
	if err := copyFile(filePath, snapshotPath); err != nil {
		_ = os.Remove(snapshotPath)
		return err
	}

	s.undoMu.Lock()
	defer s.undoMu.Unlock()
	stack := append(s.undoStacks[id], snapshotPath)
	for len(stack) > maxUndoSnapshotsPerBook {
		_ = os.Remove(stack[0])
		stack = stack[1:]
	}
	s.undoStacks[id] = stack
	return nil
}

func (s *Service) peekUndoSnapshot(id string) (string, error) {
	s.undoMu.Lock()
	defer s.undoMu.Unlock()
	stack := s.undoStacks[id]
	if len(stack) == 0 {
		return "", errors.New("không có thay đổi nào để hoàn tác cho cuốn sách này")
	}
	return stack[len(stack)-1], nil
}

func (s *Service) popUndoSnapshot(id string, snapshotPath string) {
	s.undoMu.Lock()
	defer s.undoMu.Unlock()
	stack := s.undoStacks[id]
	if len(stack) == 0 {
		return
	}
	if stack[len(stack)-1] == snapshotPath {
		stack = stack[:len(stack)-1]
		_ = os.Remove(snapshotPath)
	}
	if len(stack) == 0 {
		delete(s.undoStacks, id)
		return
	}
	s.undoStacks[id] = stack
}

func (s *Service) clearUndoStack(id string) {
	s.undoMu.Lock()
	defer s.undoMu.Unlock()
	for _, snapshotPath := range s.undoStacks[id] {
		_ = os.Remove(snapshotPath)
	}
	delete(s.undoStacks, id)
}

func (s *Service) moveUndoStack(oldID string, newID string) {
	s.undoMu.Lock()
	defer s.undoMu.Unlock()
	if oldID == newID {
		return
	}
	stack := s.undoStacks[oldID]
	if len(stack) == 0 {
		return
	}
	s.undoStacks[newID] = append(s.undoStacks[newID], stack...)
	delete(s.undoStacks, oldID)
}

func copyFile(src string, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()

	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	_, copyErr := io.Copy(out, in)
	closeErr := out.Close()
	if copyErr != nil {
		_ = os.Remove(dst)
		return copyErr
	}
	if closeErr != nil {
		_ = os.Remove(dst)
		return closeErr
	}
	return nil
}

func isChapterTitleMissing(htmlStr string) bool {
	reBody := regexp.MustCompile(`(?i)<body[^>]*>`)
	bodyLoc := reBody.FindStringIndex(htmlStr)
	var bodyContent string
	if bodyLoc == nil {
		bodyContent = htmlStr
	} else {
		bodyContent = htmlStr[bodyLoc[1]:]
	}

	reHeading := regexp.MustCompile(`(?i)<h[1-6]\b`)
	headingLoc := reHeading.FindStringIndex(bodyContent)
	if headingLoc == nil {
		return true // No heading at all
	}

	beforeHeading := bodyContent[:headingLoc[0]]
	stripped := stripTags(beforeHeading)
	unescaped := html.UnescapeString(stripped)
	unescaped = strings.ReplaceAll(unescaped, "\u00a0", " ")
	unescaped = strings.ReplaceAll(unescaped, "\u200b", " ")

	if strings.TrimSpace(unescaped) != "" {
		return true // Text exists before heading, so main title heading is missing
	}
	return false
}

