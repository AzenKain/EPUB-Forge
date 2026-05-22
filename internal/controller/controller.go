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

	"epubforge/internal/models"
	"epubforge/internal/service"
	"epubforge/internal/utils"
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
		if r.Method == http.MethodDelete {
			id, _ := url.PathUnescape(parts[0])
			err := c.service.DeleteEpub(id)
			utils.WriteJSON(w, map[string]any{"success": true}, err)
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
		res, err := c.service.Repair(id)
		utils.WriteJSON(w, res, err)
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

	var buf bytes.Buffer
	_, err = io.Copy(&buf, file)
	if err != nil {
		utils.WriteError(w, err)
		return
	}

	fileName, err := c.service.UploadEpub(header.Filename, buf.Bytes())
	utils.WriteJSON(w, map[string]any{"success": true, "fileName": fileName}, err)
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
