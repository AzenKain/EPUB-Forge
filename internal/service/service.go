package service

import (
	"bytes"
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
	"mime"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"

	"epubforge/internal/models"
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

type volumeStart struct {
	label      string
	reason     string
	confidence string
	index      int
}

var (
	workspace            string
	outputRoot           string
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
	htmlTitleRe          = regexp.MustCompile(`(?is)<h[1-3]\b[^>]*>(.*?)</h[1-3]>|<title\b[^>]*>(.*?)</title>`)
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
	bookMu sync.Mutex
	locks  map[string]*sync.Mutex
}

func New(workspaceDir string) (*Service, error) {
	workspace = workspaceDir
	outputRoot = filepath.Join(workspace, "output")
	if err := os.MkdirAll(outputRoot, 0755); err != nil {
		return nil, err
	}
	return &Service{
		locks: make(map[string]*sync.Mutex),
	}, nil
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
	clean := regexp.MustCompile(`[<>:"/\\|?*\x00-\x1f]+`).ReplaceAllString(input, " ")
	clean = strings.Join(strings.Fields(clean), " ")
	if clean == "" {
		return "epub"
	}
	if len(clean) > 120 {
		return clean[:120]
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
	if ext == ".xhtml" {
		return "application/xhtml+xml"
	}
	if ext == ".css" {
		return "text/css; charset=utf-8"
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
		strings.HasPrefix(lower, "tel:")
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
	entries, err := os.ReadDir(workspace)
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
			ID:        toID(name),
			Name:      name,
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
	lock := s.getBookLock(id)
	lock.Lock()
	defer lock.Unlock()

	ctx, err := loadBook(id)
	if err != nil {
		return models.BookMetadata{}, err
	}
	defer ctx.Close()

	normalized := normalizeMetadata(metadata, ctx.Metadata)
	err = ctx.SaveOriginalMetadata(normalized)
	if err != nil {
		return models.BookMetadata{}, err
	}
	return normalized, nil
}
