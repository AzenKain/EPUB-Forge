package service

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"epubforge/internal/models"

	"github.com/dop251/goja"
	"github.com/go-rod/rod"
	"github.com/go-rod/rod/lib/launcher"
	"github.com/go-rod/rod/lib/proto"
	"github.com/go-rod/stealth"
)

type ExtensionInput struct {
	ID           string `json:"id"`
	Type         string `json:"type"`
	Label        string `json:"label"`
	Placeholder  string `json:"placeholder,omitempty"`
	DefaultValue any    `json:"defaultValue,omitempty"`
	Required     bool   `json:"required"`
}

type ExtensionInfo struct {
	ID          string           `json:"id"`
	Name        string           `json:"name"`
	Description string           `json:"description"`
	Inputs      []ExtensionInput `json:"inputs"`
}

type JSSession struct {
	svc       *Service
	logWriter io.Writer
	runID     string
	page      *rod.Page
}

type JSSessionResponse struct {
	Status  int               `json:"status"`
	Body    string            `json:"body"`
	Headers map[string]string `json:"headers"`
}

func (s *Service) getBrowser() (*rod.Browser, error) {
	s.activeRunsMu.Lock()
	defer s.activeRunsMu.Unlock()

	if s.browser != nil {
		return s.browser, nil
	}

	var l *launcher.Launcher
	if path, has := launcher.LookPath(); has {
		l = launcher.New().Bin(path)
	} else {
		l = launcher.New()
	}
	headless := strings.ToLower(os.Getenv("EPUBFORGE_HEADLESS")) != "false" && os.Getenv("EPUBFORGE_HEADFUL") == ""
	u := l.Headless(headless).MustLaunch()

	browser := rod.New().ControlURL(u).MustConnect()
	s.browser = browser
	s.launcher = l
	return s.browser, nil
}

func (s *Service) Close() {
	s.activeRunsMu.Lock()
	defer s.activeRunsMu.Unlock()

	if s.browser != nil {
		_ = s.browser.Close()
		s.browser = nil
	}
	if s.launcher != nil {
		s.launcher.Kill()
		s.launcher = nil
	}
}

func (s *Service) NewJSSession(logWriter io.Writer, runID string) (*JSSession, error) {
	browser, err := s.getBrowser()
	if err != nil {
		return nil, err
	}

	page := stealth.MustPage(browser)
	_ = page.SetViewport(&proto.EmulationSetDeviceMetricsOverride{
		Width:  1024,
		Height: 768,
	})

	s.activeRunsMu.Lock()
	if run, ok := s.activeRuns[runID]; ok {
		run.Page = page
	}
	s.activeRunsMu.Unlock()

	return &JSSession{
		svc:       s,
		logWriter: logWriter,
		runID:     runID,
		page:      page,
	}, nil
}

func (s *JSSession) Get(urlStr string, headers map[string]string) (*JSSessionResponse, error) {
	isSubRequest := false
	if strings.Contains(urlStr, "/api/") || strings.HasSuffix(urlStr, ".json") {
		isSubRequest = true
	}
	for k, v := range headers {
		lk := strings.ToLower(k)
		if lk == "accept" && strings.Contains(strings.ToLower(v), "application/json") {
			isSubRequest = true
		}
		if lk == "x-requested-with" {
			isSubRequest = true
		}
	}

	currentURL := s.page.MustInfo().URL
	if currentURL == "" || currentURL == "about:blank" {
		isSubRequest = false
	}

	if isSubRequest {
		return s.fetchInPage(urlStr, "GET", headers, nil)
	}

	fmt.Fprintf(s.logWriter, "[*] Trình duyệt đang tải: %s\n", urlStr)
	err := s.page.Navigate(urlStr)
	if err != nil {
		return nil, fmt.Errorf("lỗi điều hướng: %w", err)
	}

	_ = s.page.WaitDOMStable(1000*time.Millisecond, 0.5)

	s.handleCloudflareChallenge()

	htmlBody := s.page.MustHTML()
	return &JSSessionResponse{
		Status:  200,
		Body:    htmlBody,
		Headers: make(map[string]string),
	}, nil
}

func (s *JSSession) Post(urlStr string, payload any, headers map[string]string) (*JSSessionResponse, error) {
	return s.fetchInPage(urlStr, "POST", headers, payload)
}

func (s *JSSession) HasCookie(cookieName string) bool {
	cookies, err := s.page.Cookies(nil)
	if err != nil {
		return false
	}
	for _, cookie := range cookies {
		if strings.Contains(cookie.Name, cookieName) {
			return true
		}
	}
	return false
}

func (s *JSSession) GetBinaryBase64(urlStr string, headers map[string]string) (string, error) {
	client := &http.Client{Timeout: 30 * time.Second}
	req, err := http.NewRequest("GET", urlStr, nil)
	if err != nil {
		return "", fmt.Errorf("lỗi tạo request tải ảnh: %w", err)
	}

	for k, v := range headers {
		req.Header.Set(k, v)
	}
	if req.Header.Get("User-Agent") == "" {
		req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
	}

	parsedURL, _ := url.Parse(urlStr)
	if parsedURL != nil {
		cookies, cerr := s.page.Cookies(nil)
		if cerr == nil {
			for _, c := range cookies {
				if strings.Contains(parsedURL.Host, c.Domain) || strings.Contains(c.Domain, strings.TrimPrefix(parsedURL.Hostname(), "www.")) {
					req.AddCookie(&http.Cookie{Name: c.Name, Value: c.Value})
				}
			}
		}
	}

	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("lỗi tải ảnh nhị phân: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return "", fmt.Errorf("lỗi tải ảnh nhị phân: HTTP %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("lỗi đọc dữ liệu ảnh: %w", err)
	}

	return base64.StdEncoding.EncodeToString(body), nil
}

func (s *JSSession) isCloudflareActive() bool {
	info, err := s.page.Info()
	if err != nil {
		return false
	}
	title := info.Title
	if strings.Contains(title, "Just a moment...") || strings.Contains(title, "Cloudflare") {
		return true
	}

	html, err := s.page.HTML()
	if err != nil {
		return false
	}
	if strings.Contains(html, "cf-challenge") || strings.Contains(html, "challenge-platform") || strings.Contains(html, "cf-turnstile") {
		return true
	}
	return false
}

func (s *JSSession) handleCloudflareChallenge() {
	if !s.isCloudflareActive() {
		return
	}

	fmt.Fprintf(s.logWriter, "[!] Phát hiện thấy rào cản Cloudflare/Captcha. Khởi tạo luồng điều khiển tương tác...\n")

	stopStream := make(chan struct{})
	go func() {
		ticker := time.NewTicker(1000 * time.Millisecond)
		defer ticker.Stop()
		for {
			select {
			case <-stopStream:
				return
			case <-ticker.C:
				s.streamPageScreenshot()
			}
		}
	}()

	start := time.Now()
	for time.Since(start) < 5*time.Minute {
		if !s.isCloudflareActive() {
			fmt.Fprintf(s.logWriter, "[+] Đã giải quyết xong Captcha/Cloudflare!\n")
			resolvedMsg := map[string]any{
				"type": "captcha_resolved",
			}
			resolvedBytes, _ := json.Marshal(resolvedMsg)
			fmt.Fprintln(s.logWriter, string(resolvedBytes))
			break
		}
		time.Sleep(1 * time.Second)
	}
	close(stopStream)
}

func (s *JSSession) streamPageScreenshot() {
	quality := int(75)
	imgBytes, err := s.page.Screenshot(true, &proto.PageCaptureScreenshot{
		Format:  proto.PageCaptureScreenshotFormatJpeg,
		Quality: &quality,
	})
	if err != nil {
		return
	}

	base64Img := base64.StdEncoding.EncodeToString(imgBytes)
	msg := map[string]any{
		"type":       "captcha_required",
		"screenshot": "data:image/jpeg;base64," + base64Img,
		"runId":      s.runID,
	}

	jsonBytes, err := json.Marshal(msg)
	if err == nil {
		fmt.Fprintln(s.logWriter, string(jsonBytes))
	}
}

func (s *JSSession) fetchInPage(urlStr, method string, headers map[string]string, payload any) (*JSSessionResponse, error) {
	var bodyJSON string
	if payload != nil {
		isJSON := false
		for k, v := range headers {
			if strings.ToLower(k) == "content-type" && strings.Contains(strings.ToLower(v), "application/json") {
				isJSON = true
			}
		}

		if isJSON {
			jsonBytes, err := json.Marshal(payload)
			if err != nil {
				return nil, err
			}
			bodyJSON = string(jsonBytes)
		} else {
			values := url.Values{}
			if m, ok := payload.(map[string]any); ok {
				for k, v := range m {
					values.Set(k, fmt.Sprintf("%v", v))
				}
			} else if m, ok := payload.(map[string]string); ok {
				for k, v := range m {
					values.Set(k, v)
				}
			}
			bodyJSON = values.Encode()
		}
	}

	fetchScript := `
		async (url, method, headersJson, bodyStr) => {
			const headers = JSON.parse(headersJson);
			const options = {
				method: method,
				headers: headers
			};
			if (bodyStr) {
				options.body = bodyStr;
			}
			const resp = await fetch(url, options);
			const text = await resp.text();
			const respHeaders = {};
			resp.headers.forEach((v, k) => { respHeaders[k] = v; });
			return {
				status: resp.status,
				body: text,
				headers: respHeaders
			};
		}
	`

	headersBytes, _ := json.Marshal(headers)

	res, err := s.page.Evaluate(rod.Eval(fetchScript, urlStr, method, string(headersBytes), bodyJSON).ByPromise())
	if err != nil {
		return nil, fmt.Errorf("lỗi thực thi fetch trong trang: %w", err)
	}

	var resp JSSessionResponse
	err = res.Value.Unmarshal(&resp)
	if err != nil {
		return nil, fmt.Errorf("lỗi phân giải kết quả fetch: %w", err)
	}

	return &resp, nil
}

func (s *Service) extensionsDir() string {
	dir := filepath.Join(workspace, "extensions")
	_ = os.MkdirAll(dir, 0755)
	return dir
}

func (s *Service) ListExtensions() ([]ExtensionInfo, error) {
	dir := s.extensionsDir()
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}

	var list []ExtensionInfo
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(strings.ToLower(entry.Name()), ".js") {
			continue
		}

		filePath := filepath.Join(dir, entry.Name())
		jsBytes, err := os.ReadFile(filePath)
		if err != nil {
			continue
		}

		info, err := s.parseExtensionMeta(string(jsBytes))
		if err != nil {
			continue
		}
		list = append(list, info)
	}

	return list, nil
}

func (s *Service) parseExtensionMeta(jsCode string) (ExtensionInfo, error) {
	vm := goja.New()
	_, err := vm.RunString(jsCode)
	if err != nil {
		return ExtensionInfo{}, err
	}

	var register func() map[string]any
	err = vm.ExportTo(vm.Get("register"), &register)
	if err != nil {
		return ExtensionInfo{}, errors.New("missing register() function")
	}

	meta := register()
	jsonBytes, err := json.Marshal(meta)
	if err != nil {
		return ExtensionInfo{}, err
	}

	var info ExtensionInfo
	if err := json.Unmarshal(jsonBytes, &info); err != nil {
		return ExtensionInfo{}, err
	}

	if info.ID == "" {
		return ExtensionInfo{}, errors.New("extension metadata missing id")
	}
	return info, nil
}

func (s *Service) RunExtension(ctx context.Context, id string, inputs map[string]any, logWriter io.Writer) ([]string, error) {
	dir := s.extensionsDir()
	filePath := filepath.Join(dir, id+".js")
	if _, err := os.Stat(filePath); os.IsNotExist(err) {
		return nil, fmt.Errorf("extension %q not found", id)
	}

	jsBytes, err := os.ReadFile(filePath)
	if err != nil {
		return nil, err
	}

	runID := "run_" + randomID()
	activeRun := &ActiveRun{
		SessionID: runID,
	}

	s.activeRunsMu.Lock()
	s.activeRuns[runID] = activeRun
	s.activeRunsMu.Unlock()

	defer func() {
		s.activeRunsMu.Lock()
		delete(s.activeRuns, runID)
		s.activeRunsMu.Unlock()

		if activeRun.Page != nil {
			_ = activeRun.Page.Close()
		}
	}()

	startMsg := map[string]any{
		"type":  "start",
		"runId": runID,
	}
	startBytes, _ := json.Marshal(startMsg)
	fmt.Fprintln(logWriter, string(startBytes))

	fmt.Fprintf(logWriter, "[*] Khởi tạo sandbox Extension Runner...\n")
	vm := goja.New()

	vm.Set("console", map[string]any{
		"log": func(args ...any) {
			parts := make([]string, len(args))
			for i, v := range args {
				parts[i] = fmt.Sprintf("%v", v)
			}
			line := strings.Join(parts, " ")
			fmt.Fprintln(logWriter, line)
		},
	})

	vm.Set("http", map[string]any{
		"newSession": func() *JSSession {
			sess, err := s.NewJSSession(logWriter, runID)
			if err != nil {
				panic(err)
			}
			return sess
		},
	})

	vm.Set("utils", map[string]any{
		"sleep": func(ms int64) {
			time.Sleep(time.Duration(ms) * time.Millisecond)
		},
		"base64ToBytes": func(s string) ([]byte, error) {
			return base64.StdEncoding.DecodeString(s)
		},
		"bytesToBase64": func(b []byte) string {
			return base64.StdEncoding.EncodeToString(b)
		},
		"stringToBytes": func(s string) []byte {
			return []byte(s)
		},
		"bytesToString": func(b []byte) string {
			return string(b)
		},
	})

	_, err = vm.RunString(string(jsBytes))
	if err != nil {
		return nil, fmt.Errorf("lỗi khởi tạo script: %w", err)
	}

	var runFunc func(map[string]any) any
	err = vm.ExportTo(vm.Get("run"), &runFunc)
	if err != nil {
		return nil, errors.New("missing run(params) function in script")
	}

	fmt.Fprintf(logWriter, "[*] Đang thực thi mã nguồn Extension...\n")

	doneChan := make(chan struct{})
	defer close(doneChan)

	go func() {
		select {
		case <-ctx.Done():
			vm.Interrupt(context.Canceled)
		case <-doneChan:
		}
	}()

	var result any
	errChan := make(chan error, 1)
	go func() {
		defer func() {
			if r := recover(); r != nil {
				if err, ok := r.(error); ok && errors.Is(err, context.Canceled) {
					errChan <- context.Canceled
				} else {
					errChan <- fmt.Errorf("JS execution panic: %v", r)
				}
			}
		}()
		result = runFunc(inputs)
		errChan <- nil
	}()

	select {
	case err := <-errChan:
		if err != nil {
			if errors.Is(err, context.Canceled) {
				fmt.Fprintf(logWriter, "[-] Đã huỷ thực thi theo yêu cầu của người dùng.\n")
				return nil, err
			}
			return nil, err
		}
	case <-ctx.Done():
		return nil, context.Canceled
	}

	if result == nil {
		return nil, errors.New("kết quả trả về từ extension rỗng (null/undefined)")
	}

	fmt.Fprintf(logWriter, "[*] Đang đóng gói dữ liệu thành tệp tin EPUB...\n")

	var ebooks []map[string]any

	if mapRes, ok := result.(map[string]any); ok {
		if ebooksVal, ok := mapRes["ebooks"]; ok {
			if sliceVal, ok := ebooksVal.([]any); ok {
				for _, item := range sliceVal {
					if m, ok := item.(map[string]any); ok {
						ebooks = append(ebooks, m)
					}
				}
			} else if sliceVal, ok := ebooksVal.([]map[string]any); ok {
				ebooks = append(ebooks, sliceVal...)
			}
		}
		if len(ebooks) == 0 {
			ebooks = append(ebooks, mapRes)
		}
	} else if sliceRes, ok := result.([]any); ok {
		for _, item := range sliceRes {
			if m, ok := item.(map[string]any); ok {
				ebooks = append(ebooks, m)
			}
		}
	} else if sliceRes, ok := result.([]map[string]any); ok {
		ebooks = append(ebooks, sliceRes...)
	}

	if len(ebooks) == 0 {
		return nil, errors.New("dữ liệu trả về không hợp lệ, không tìm thấy thông tin sách")
	}

	var createdBooks []string
	for _, m := range ebooks {
		jsonBytes, err := json.Marshal(m)
		if err != nil {
			return nil, fmt.Errorf("lỗi đóng gói kết quả: %w", err)
		}

		var req models.CreateEpubRequest
		if err := json.Unmarshal(jsonBytes, &req); err != nil {
			return nil, fmt.Errorf("dữ liệu trả về không khớp cấu trúc EPUB: %w", err)
		}

		assetsMap := make(map[string]string)
		if jsImages, ok := m["images"].(map[string]any); ok {
			for k, v := range jsImages {
				if base64Str, ok := v.(string); ok {
					assetsMap[k] = base64Str
				}
			}
		}
		req.Assets = assetsMap

		outputName, err := s.CreateEpub(req, nil)
		if err != nil {
			return nil, fmt.Errorf("lỗi biên dịch EPUB: %w", err)
		}
		createdBooks = append(createdBooks, outputName)
	}

	outputNamesStr := strings.Join(createdBooks, ", ")
	fmt.Fprintf(logWriter, "[+] Đã tạo sách thành công: %s\n", outputNamesStr)
	return createdBooks, nil
}

func (s *Service) AddExtension(jsCode []byte) (ExtensionInfo, error) {
	info, err := s.parseExtensionMeta(string(jsCode))
	if err != nil {
		return ExtensionInfo{}, fmt.Errorf("extension không hợp lệ: %w", err)
	}

	dir := s.extensionsDir()
	filePath := filepath.Join(dir, info.ID+".js")
	if err := os.WriteFile(filePath, jsCode, 0644); err != nil {
		return ExtensionInfo{}, fmt.Errorf("không thể ghi file extension: %w", err)
	}

	return info, nil
}

func (s *Service) DeleteExtension(id string) error {
	dir := s.extensionsDir()
	filePath := filepath.Join(dir, id+".js")
	if _, err := os.Stat(filePath); os.IsNotExist(err) {
		return fmt.Errorf("extension %q không tồn tại", id)
	}
	return os.Remove(filePath)
}

func (s *Service) InteractExtension(runID string, action string, x, y float64, text string) (string, error) {
	s.activeRunsMu.RLock()
	run, ok := s.activeRuns[runID]
	s.activeRunsMu.RUnlock()

	if !ok {
		return "", fmt.Errorf("không tìm thấy session chạy extension tương ứng: %s", runID)
	}

	if run.Page == nil {
		return "", fmt.Errorf("trình duyệt chưa được tải sẵn cho session này")
	}

	run.Mu.Lock()
	defer run.Mu.Unlock()

	switch action {
	case "click":
		err := run.Page.Mouse.MoveTo(proto.Point{X: x, Y: y})
		if err != nil {
			return "", fmt.Errorf("không thể di chuyển chuột: %w", err)
		}
		err = run.Page.Mouse.Click(proto.InputMouseButtonLeft, 1)
		if err != nil {
			return "", fmt.Errorf("không thể click chuột: %w", err)
		}
	case "type":
		err := run.Page.InsertText(text)
		if err != nil {
			return "", fmt.Errorf("không thể nhập text: %w", err)
		}
	default:
		return "", fmt.Errorf("hành động không được hỗ trợ: %s", action)
	}

	_ = run.Page.WaitDOMStable(500*time.Millisecond, 0.5)

	quality := int(75)
	imgBytes, err := run.Page.Screenshot(true, &proto.PageCaptureScreenshot{
		Format:  proto.PageCaptureScreenshotFormatJpeg,
		Quality: &quality,
	})
	if err != nil {
		return "", fmt.Errorf("không thể chụp màn hình: %w", err)
	}

	return "data:image/jpeg;base64," + base64.StdEncoding.EncodeToString(imgBytes), nil
}
