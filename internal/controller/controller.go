package controller

import (
	"bytes"
	"encoding/json"
	"io"
	"io/fs"
	"net/http"
	"net/url"
	"path"
	"strconv"
	"strings"
	"sync"

	"epubforge/internal/models"
	"epubforge/internal/service"
	"epubforge/internal/utils"
	"time"
)

type Controller struct {
	service  *service.Service
	frontend fs.FS
}

func New(svc *service.Service, frontend fs.FS) *Controller {
	return &Controller{service: svc, frontend: frontend}
}

func (c *Controller) ListEpubs(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/api/epubs" {
		http.NotFound(w, r)
		return
	}
	files, err := c.service.ListEpubs()
	utils.WriteJSON(w, files, err)
}

func (c *Controller) Epub(w http.ResponseWriter, r *http.Request) {
	parts := strings.Split(strings.TrimPrefix(r.URL.Path, "/api/epubs/"), "/")
	if len(parts) == 1 || (len(parts) == 2 && parts[1] == "") {
		id, _ := url.PathUnescape(parts[0])
		if r.Method == http.MethodDelete {
			err := c.service.DeleteEpub(id)
			utils.WriteJSON(w, map[string]any{"success": true}, err)
			return
		}
		if r.Method == http.MethodPatch {
			var req models.RenameEpubRequest
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				utils.WriteError(w, err)
				return
			}
			file, err := c.service.RenameEpub(id, req.Name)
			utils.WriteJSON(w, file, err)
			return
		}
	}
	if len(parts) < 2 {
		http.NotFound(w, r)
		return
	}
	id, _ := url.PathUnescape(parts[0])
	switch {
	case len(parts) == 2 && parts[1] == "analyze":
		analysis, err := c.service.Analyze(id)
		utils.WriteJSON(w, analysis, err)
	case len(parts) == 2 && parts[1] == "move":
		if r.Method != http.MethodPost {
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		var req models.MoveEpubRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			utils.WriteError(w, err)
			return
		}
		file, err := c.service.MoveEpub(id, req.Folder)
		utils.WriteJSON(w, file, err)
	case len(parts) == 2 && parts[1] == "undo":
		if r.Method == http.MethodGet {
			status, err := c.service.UndoStatus(id)
			utils.WriteJSON(w, status, err)
			return
		}
		if r.Method != http.MethodPost {
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		analysis, err := c.service.Undo(id)
		utils.WriteJSON(w, analysis, err)
	case len(parts) == 2 && parts[1] == "fonts":
		c.EmbedFont(id, w, r)
	case len(parts) == 3 && parts[1] == "chapters" && strings.HasSuffix(parts[2], "html"):
		http.NotFound(w, r)
	case len(parts) == 3 && parts[1] == "chapters" && parts[2] == "edit":
		if r.Method != http.MethodPost {
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		var req models.ChapterEditRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			utils.WriteError(w, err)
			return
		}
		analysis, err := c.service.EditChapters(id, req)
		utils.WriteJSON(w, analysis, err)
	case len(parts) == 3 && parts[1] == "chapters" && parts[2] == "clean":
		if r.Method != http.MethodPost {
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		var req models.ChapterEditRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			utils.WriteError(w, err)
			return
		}
		cleaned, err := c.service.CleanChapter(id, req)
		if err != nil {
			utils.WriteError(w, err)
			return
		}
		utils.WriteJSON(w, map[string]any{"content": cleaned}, nil)
	case len(parts) == 4 && parts[1] == "chapters" && parts[3] == "html":
		idx, _ := strconv.Atoi(parts[2])
		raw := r.URL.Query().Get("raw") == "true"
		data, err := c.service.ChapterHTML(id, idx, raw)
		if err != nil {
			utils.WriteError(w, err)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = w.Write([]byte(data))
	case len(parts) == 2 && parts[1] == "gallery":
		if r.Method == http.MethodGet {
			resp, err := c.service.GetGallery(id)
			utils.WriteJSON(w, resp, err)
		} else if r.Method == http.MethodPost {
			var req models.SaveGalleryRequest
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				utils.WriteError(w, err)
				return
			}
			analysis, err := c.service.SaveGallery(id, req)
			utils.WriteJSON(w, analysis, err)
		} else {
			w.WriteHeader(http.StatusMethodNotAllowed)
		}
	case len(parts) == 3 && parts[1] == "gallery" && parts[2] == "download":
		var req models.GalleryDownloadRequest
		switch r.Method {
		case http.MethodGet:
			query := r.URL.Query()
			req.Paths = query["path"]
			req.All = query.Get("all") == "true" || query.Get("scope") == "all"
		case http.MethodPost:
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				utils.WriteError(w, err)
				return
			}
		default:
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}

		headersSent := false
		err := c.service.StreamGalleryDownload(id, req.Paths, req.All, w, func(info service.GalleryDownloadInfo) {
			headersSent = true
			fileName := strings.ReplaceAll(info.FileName, `"`, "")
			w.Header().Set("Content-Type", info.ContentType)
			w.Header().Set("Content-Disposition", `attachment; filename="`+fileName+`"`)
			w.Header().Set("X-Content-Type-Options", "nosniff")
			w.Header().Set("Cache-Control", "no-store")
		})
		if err != nil && !headersSent {
			utils.WriteError(w, err)
			return
		}
	case len(parts) == 2 && parts[1] == "assets":
		data, contentType, err := c.service.Asset(id, r.URL.Query().Get("path"))
		if err != nil {
			utils.WriteError(w, err)
			return
		}
		w.Header().Set("Content-Type", contentType)
		_, _ = w.Write(data)
	case len(parts) == 2 && parts[1] == "export":
		if r.Method != http.MethodPost {
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		var req models.ExportRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			utils.WriteError(w, err)
			return
		}

		w.Header().Set("Content-Type", "application/x-ndjson")
		w.Header().Set("Transfer-Encoding", "chunked")
		w.Header().Set("Cache-Control", "no-cache")
		w.Header().Set("Connection", "keep-alive")

		flusher, ok := w.(http.Flusher)

		onProgress := func(index, total int, label string) {
			msg := map[string]any{
				"type":  "progress",
				"index": index,
				"total": total,
				"label": label,
			}
			_ = json.NewEncoder(w).Encode(msg)
			if ok {
				flusher.Flush()
			}
		}

		files, err := c.service.Export(id, req.Ranges, req.IncludeFrontmatter, req.Metadata, req.CoverImage, onProgress)
		if err != nil {
			_ = json.NewEncoder(w).Encode(map[string]any{
				"type":  "error",
				"error": err.Error(),
			})
			return
		}

		_ = json.NewEncoder(w).Encode(map[string]any{
			"type":  "done",
			"files": files,
		})
	case len(parts) == 2 && parts[1] == "range-images":
		if r.Method != http.MethodPost {
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		var req models.RangeImagesRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			utils.WriteError(w, err)
			return
		}
		images, err := c.service.RangeImages(id, req.StartIndex, req.EndIndex, req.IncludeFrontmatter)
		utils.WriteJSON(w, images, err)
	case len(parts) == 2 && parts[1] == "metadata":
		if r.Method != http.MethodPut {
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		var metadata models.BookMetadata
		if err := json.NewDecoder(r.Body).Decode(&metadata); err != nil {
			utils.WriteError(w, err)
			return
		}
		normalized, err := c.service.SaveMetadata(id, metadata)
		utils.WriteJSON(w, map[string]any{"metadata": normalized}, err)
	case len(parts) == 2 && parts[1] == "optimize":
		if r.Method != http.MethodPost {
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		var req models.OptimizeRequest
		if r.ContentLength > 0 {
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				utils.WriteError(w, err)
				return
			}
		} else {
			req.CleanUnusedImages = true
			req.CleanUnusedFonts = true
			req.CompressImages = true
			req.ConvertToWebp = true
			req.ImageQuality = 100
			req.CleanHTML = false
			req.StripInlineStyles = true
			req.RemoveEmptyLines = true
			req.NormalizeParagraphs = true
		}
		res, err := c.service.Optimize(id, req)
		utils.WriteJSON(w, res, err)
	case len(parts) == 2 && parts[1] == "repair":
		if r.Method != http.MethodPost {
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		var req models.RepairRequest
		if r.ContentLength > 0 {
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				utils.WriteError(w, err)
				return
			}
		}
		res, err := c.service.Repair(id, req.Fixes)
		utils.WriteJSON(w, res, err)
	case len(parts) == 2 && parts[1] == "validate":
		if r.Method != http.MethodPost && r.Method != http.MethodGet {
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		res, err := c.service.Validate(id)
		utils.WriteJSON(w, res, err)
	case len(parts) == 2 && parts[1] == "toc":
		if r.Method == http.MethodGet {
			nodes, err := c.service.GetTOCNodes(id)
			utils.WriteJSON(w, nodes, err)
		} else if r.Method == http.MethodPost {
			var nodes []models.TocNode
			if err := json.NewDecoder(r.Body).Decode(&nodes); err != nil {
				utils.WriteError(w, err)
				return
			}
			analysis, err := c.service.UpdateTOC(id, nodes)
			utils.WriteJSON(w, analysis, err)
		} else {
			w.WriteHeader(http.StatusMethodNotAllowed)
		}
	case len(parts) == 2 && parts[1] == "find":
		if r.Method != http.MethodPost {
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		var req models.FindRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			utils.WriteError(w, err)
			return
		}
		res, err := c.service.Find(id, req)
		utils.WriteJSON(w, res, err)
	case len(parts) == 2 && parts[1] == "replace":
		if r.Method != http.MethodPost {
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		var req models.ReplaceRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			utils.WriteError(w, err)
			return
		}
		res, err := c.service.Replace(id, req)
		utils.WriteJSON(w, res, err)
	default:
		http.NotFound(w, r)
	}
}

func (c *Controller) File(w http.ResponseWriter, r *http.Request) {
	rel, _ := url.PathUnescape(strings.TrimPrefix(r.URL.Path, "/api/files/"))
	full, name, err := c.service.OutputFile(rel)
	if err != nil {
		utils.WriteError(w, err)
		return
	}
	w.Header().Set("Content-Disposition", `attachment; filename="`+name+`"`)
	http.ServeFile(w, r, full)
}

func (c *Controller) Frontend(w http.ResponseWriter, r *http.Request) {
	dist, err := fs.Sub(c.frontend, "dist")
	if err != nil {
		utils.WriteError(w, err)
		return
	}
	name := strings.TrimPrefix(path.Clean("/"+r.URL.Path), "/")
	if name == "." || name == "" {
		name = "index.html"
	}

	w.Header().Set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
	w.Header().Set("Pragma", "no-cache")
	w.Header().Set("Expires", "0")

	if utils.ServeEmbeddedFile(w, r, dist, name) {
		return
	}
	utils.ServeEmbeddedFile(w, r, dist, "index.html")
}

func (c *Controller) MergeEpubs(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	var req models.MergeEpubsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		utils.WriteError(w, err)
		return
	}
	fileName, err := c.service.MergeEpubs(req.BookIDs, req.Title)
	utils.WriteJSON(w, map[string]any{"success": true, "fileName": fileName}, err)
}

func (c *Controller) ImportTxt(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	var req models.ImportTxtRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		utils.WriteError(w, err)
		return
	}
	fileName, err := c.service.ImportTxt(req)
	utils.WriteJSON(w, map[string]any{"success": true, "fileName": fileName}, err)
}

func (c *Controller) CreateEpub(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	if err := r.ParseMultipartForm(500 << 20); err != nil {
		utils.WriteError(w, err)
		return
	}

	payload := r.FormValue("payload")
	if payload == "" {
		http.Error(w, "payload is required", http.StatusBadRequest)
		return
	}

	var req models.CreateEpubRequest
	if err := json.Unmarshal([]byte(payload), &req); err != nil {
		utils.WriteError(w, err)
		return
	}

	imagesByChapter := make(map[string][]models.UploadedMangaImage)
	if r.MultipartForm != nil {
		for key, files := range r.MultipartForm.File {
			if !strings.HasPrefix(key, "images_") {
				continue
			}
			chapterID := strings.TrimPrefix(key, "images_")
			for _, fh := range files {
				f, err := fh.Open()
				if err != nil {
					utils.WriteError(w, err)
					return
				}
				var buf bytes.Buffer
				_, err = io.Copy(&buf, f)
				f.Close()
				if err != nil {
					utils.WriteError(w, err)
					return
				}
				imagesByChapter[chapterID] = append(imagesByChapter[chapterID], models.UploadedMangaImage{
					Filename: fh.Filename,
					Data:     buf.Bytes(),
				})
			}
		}
	}

	fileName, err := c.service.CreateEpub(req, imagesByChapter)
	utils.WriteJSON(w, map[string]any{"success": true, "fileName": fileName}, err)
}

func (c *Controller) EmbedFont(id string, w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	err := r.ParseMultipartForm(20 << 20)
	if err != nil {
		utils.WriteError(w, err)
		return
	}

	fontName := r.FormValue("fontName")
	if fontName == "" {
		http.Error(w, "fontName is required", http.StatusBadRequest)
		return
	}

	file, header, err := r.FormFile("file")
	if err != nil {
		http.Error(w, "file is required", http.StatusBadRequest)
		return
	}
	defer file.Close()

	var buf bytes.Buffer
	_, err = io.Copy(&buf, file)
	if err != nil {
		utils.WriteError(w, err)
		return
	}

	analysis, err := c.service.EmbedFont(id, fontName, header.Filename, buf.Bytes())
	utils.WriteJSON(w, analysis, err)
}

func (c *Controller) UploadEpub(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	err := r.ParseMultipartForm(100 << 20)
	if err != nil {
		utils.WriteError(w, err)
		return
	}

	file, header, err := r.FormFile("file")
	if err != nil {
		http.Error(w, "file is required", http.StatusBadRequest)
		return
	}
	defer file.Close()

	folder := strings.TrimSpace(r.FormValue("folder"))
	if folder == "" {
		folder = strings.TrimSpace(r.URL.Query().Get("folder"))
	}

	var buf bytes.Buffer
	_, err = io.Copy(&buf, file)
	if err != nil {
		utils.WriteError(w, err)
		return
	}

	fileName, err := c.service.UploadEpub(header.Filename, buf.Bytes(), folder)
	utils.WriteJSON(w, map[string]any{"success": true, "fileName": fileName}, err)
}

func (c *Controller) Folders(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		folders, err := c.service.ListFolders()
		utils.WriteJSON(w, folders, err)
	case http.MethodPost:
		var req models.CreateFolderRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			utils.WriteError(w, err)
			return
		}
		folder, err := c.service.CreateFolder(req.Name)
		utils.WriteJSON(w, map[string]any{"success": true, "name": folder}, err)
	default:
		w.WriteHeader(http.StatusMethodNotAllowed)
	}
}

func (c *Controller) Folder(w http.ResponseWriter, r *http.Request) {
	folderName := strings.TrimPrefix(r.URL.Path, "/api/folders/")
	folderName, _ = url.PathUnescape(folderName)
	if folderName == "" {
		http.NotFound(w, r)
		return
	}

	switch r.Method {
	case http.MethodPatch:
		var req models.RenameFolderRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			utils.WriteError(w, err)
			return
		}
		err := c.service.RenameFolder(folderName, req.Name)
		utils.WriteJSON(w, map[string]any{"success": true}, err)
	case http.MethodDelete:
		err := c.service.DeleteFolder(folderName)
		utils.WriteJSON(w, map[string]any{"success": true}, err)
	default:
		w.WriteHeader(http.StatusMethodNotAllowed)
	}
}

func (c *Controller) SearchMetadata(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	query := r.URL.Query().Get("q")
	source := r.URL.Query().Get("source")
	results, err := c.service.SearchMetadataOnline(query, source)
	utils.WriteJSON(w, results, err)
}

func (c *Controller) CreateManga(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	err := r.ParseMultipartForm(300 << 20)
	if err != nil {
		utils.WriteError(w, err)
		return
	}

	title := r.FormValue("title")
	author := r.FormValue("author")
	direction := r.FormValue("direction")

	if title == "" {
		http.Error(w, "Tiêu đề truyện tranh là bắt buộc", http.StatusBadRequest)
		return
	}

	form := r.MultipartForm
	files := form.File["images"]
	if len(files) == 0 {
		http.Error(w, "Vui lòng tải lên ít nhất một ảnh", http.StatusBadRequest)
		return
	}

	var uploadedImages []models.UploadedMangaImage
	for _, fh := range files {
		f, err := fh.Open()
		if err != nil {
			utils.WriteError(w, err)
			return
		}
		var buf bytes.Buffer
		_, err = io.Copy(&buf, f)
		f.Close()
		if err != nil {
			utils.WriteError(w, err)
			return
		}

		uploadedImages = append(uploadedImages, models.UploadedMangaImage{
			Filename: fh.Filename,
			Data:     buf.Bytes(),
		})
	}

	outputName, err := c.service.CreateManga(title, author, direction, uploadedImages)
	if err != nil {
		utils.WriteError(w, err)
		return
	}

	utils.WriteJSON(w, map[string]any{"success": true, "fileName": outputName}, nil)
}

func (c *Controller) ListExtensions(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	exts, err := c.service.ListExtensions()
	utils.WriteJSON(w, exts, err)
}

func (c *Controller) RunExtension(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	id := r.URL.Query().Get("id")
	if id == "" {
		http.Error(w, "id query parameter is required", http.StatusBadRequest)
		return
	}

	var inputs map[string]any
	if err := json.NewDecoder(r.Body).Decode(&inputs); err != nil {
		utils.WriteError(w, err)
		return
	}

	w.Header().Set("Content-Type", "application/x-ndjson")
	w.Header().Set("Transfer-Encoding", "chunked")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")

	flusher, _ := w.(http.Flusher)
	logWriter := &responseLogWriter{w: w, flusher: flusher}

	fileNames, warnings, err := c.service.RunExtension(r.Context(), id, inputs, logWriter)
	if err != nil {
		_ = json.NewEncoder(w).Encode(map[string]any{
			"type":  "error",
			"error": err.Error(),
		})
		return
	}

	_ = json.NewEncoder(w).Encode(map[string]any{
		"type":      "done",
		"fileNames": fileNames,
		"fileName":  strings.Join(fileNames, ", "),
		"warnings":  warnings,
	})
}

type responseLogWriter struct {
	w       http.ResponseWriter
	flusher http.Flusher
	mu      sync.Mutex
}

func (rlw *responseLogWriter) Write(p []byte) (n int, err error) {
	rlw.mu.Lock()
	defer rlw.mu.Unlock()
	defer func() {
		if recovered := recover(); recovered != nil {
			n = 0
			err = http.ErrAbortHandler
		}
	}()

	trimmed := bytes.TrimSpace(p)
	if len(trimmed) > 1 && trimmed[0] == '{' && trimmed[len(trimmed)-1] == '}' {
		var js json.RawMessage
		if json.Unmarshal(trimmed, &js) == nil {
			_, err = rlw.w.Write(p)
			if err == nil && rlw.flusher != nil {
				rlw.flusher.Flush()
			}
			return len(p), err
		}
	}

	msg := map[string]any{
		"type":    "log",
		"message": strings.TrimSuffix(string(p), "\n"),
	}
	err = json.NewEncoder(rlw.w).Encode(msg)
	if err == nil && rlw.flusher != nil {
		rlw.flusher.Flush()
	}
	return len(p), err
}

func (c *Controller) UploadExtension(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	err := r.ParseMultipartForm(5 << 20)
	if err != nil {
		utils.WriteError(w, err)
		return
	}

	file, header, err := r.FormFile("file")
	if err != nil {
		http.Error(w, "file is required", http.StatusBadRequest)
		return
	}
	defer file.Close()

	if !strings.HasSuffix(strings.ToLower(header.Filename), ".js") {
		http.Error(w, "Chỉ chấp nhận tệp tin .js", http.StatusBadRequest)
		return
	}

	var buf bytes.Buffer
	_, err = io.Copy(&buf, file)
	if err != nil {
		utils.WriteError(w, err)
		return
	}

	info, err := c.service.AddExtension(buf.Bytes())
	utils.WriteJSON(w, info, err)
}

func (c *Controller) DeleteExtension(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost && r.Method != http.MethodDelete {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	id := r.URL.Query().Get("id")
	if id == "" {
		var req struct {
			ID string `json:"id"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err == nil {
			id = req.ID
		}
	}

	if id == "" {
		http.Error(w, "yêu cầu tham số id", http.StatusBadRequest)
		return
	}

	err := c.service.DeleteExtension(id)
	utils.WriteJSON(w, map[string]any{"success": true}, err)
}

func (c *Controller) InteractExtension(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		RunID  string  `json:"runId"`
		Action string  `json:"action"`
		X      float64 `json:"x"`
		Y      float64 `json:"y"`
		Text   string  `json:"text"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		utils.WriteError(w, err)
		return
	}

	if req.RunID == "" {
		http.Error(w, "runId is required", http.StatusBadRequest)
		return
	}

	screenshot, err := c.service.InteractExtension(req.RunID, req.Action, req.X, req.Y, req.Text)
	if err != nil {
		utils.WriteError(w, err)
		return
	}

	utils.WriteJSON(w, map[string]any{
		"success":    true,
		"screenshot": screenshot,
	}, nil)
}

func (c *Controller) CheckUpdate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	res, err := c.service.CheckUpdate(r.Context())
	utils.WriteJSON(w, res, err)
}

func (c *Controller) RunUpdate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	err := c.service.RunUpdate()
	if err != nil {
		utils.WriteError(w, err)
		return
	}
	utils.WriteJSON(w, map[string]any{"success": true}, nil)
}

func (c *Controller) GetUpdateProgress(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	res := c.service.GetUpdateProgress()
	utils.WriteJSON(w, res, nil)
}

func (c *Controller) RestartApp(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	utils.WriteJSON(w, map[string]any{"success": true}, nil)

	go func() {
		time.Sleep(500 * time.Millisecond)
		c.service.RestartApp()
	}()
}

func (c *Controller) StoreExtensions(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	items, err := c.service.FetchStoreExtensions()
	utils.WriteJSON(w, items, err)
}

func (c *Controller) InstallExtension(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		DownloadURL string `json:"downloadUrl"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		utils.WriteError(w, err)
		return
	}

	if req.DownloadURL == "" {
		http.Error(w, "downloadUrl is required", http.StatusBadRequest)
		return
	}

	info, err := c.service.InstallStoreExtension(req.DownloadURL)
	utils.WriteJSON(w, info, err)
}

func (c *Controller) UpdateExtension(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		ID string `json:"id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		utils.WriteError(w, err)
		return
	}

	if req.ID == "" {
		http.Error(w, "id is required", http.StatusBadRequest)
		return
	}

	info, err := c.service.UpdateExtension(req.ID)
	utils.WriteJSON(w, info, err)
}
