package service

import (
	"bytes"
	"context"
	"crypto/md5"
	"crypto/tls"
	"crypto/x509"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"maps"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	embeddedextensions "epubforge/extensions"
	"epubforge/internal/models"

	"github.com/dop251/goja"
	"github.com/go-rod/rod"
	"github.com/go-rod/rod/lib/launcher"
	"github.com/go-rod/rod/lib/proto"
	"github.com/go-rod/stealth"
)

type ExtensionInput struct {
	ID          string `json:"id"`
	Type        string `json:"type"`
	Label       string `json:"label"`
	Placeholder string `json:"placeholder,omitempty"`
	Options     []struct {
		Value       string `json:"value"`
		Label       string `json:"label"`
		Description string `json:"description,omitempty"`
	} `json:"options,omitempty"`
	VisibleWhen  map[string]any `json:"visibleWhen,omitempty"`
	DefaultValue any            `json:"defaultValue,omitempty"`
	Required     bool           `json:"required"`
}

type ExtensionInfo struct {
	ID          string           `json:"id"`
	Name        string           `json:"name"`
	Description string           `json:"description"`
	Inputs      []ExtensionInput `json:"inputs"`
	IsOfficial  bool             `json:"isOfficial"`
	Md5         string           `json:"md5"`
	HasUpdate   bool             `json:"hasUpdate"`
}

type StoreExtensionInfo struct {
	ID          string           `json:"id"`
	Name        string           `json:"name"`
	Description string           `json:"description"`
	Inputs      []ExtensionInput `json:"inputs"`
	Md5         string           `json:"md5"`
	DownloadURL string           `json:"downloadUrl"`
	Size        int64            `json:"size"`
	Installed   bool             `json:"installed"`
	HasUpdate   bool             `json:"hasUpdate"`
}

func computeMD5(data []byte) string {
	normalized := bytes.ReplaceAll(data, []byte("\r\n"), []byte("\n"))
	hash := md5.Sum(normalized)
	return hex.EncodeToString(hash[:])
}

type JSSession struct {
	svc       *Service
	logWriter io.Writer
	runID     string
	page      *rod.Page
	jar       http.CookieJar
}

type JSSessionResponse struct {
	Status  int               `json:"status"`
	Body    string            `json:"body"`
	Headers map[string]string `json:"headers"`
}

type extensionChoiceOption struct {
	ID          string `json:"id"`
	Label       string `json:"label"`
	Description string `json:"description,omitempty"`
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
	u := l.Leakless(false).Headless(headless).Set("disable-web-security").Set("ignore-certificate-errors").MustLaunch()

	browser := rod.New().ControlURL(u).MustConnect()
	s.browser = browser
	s.launcher = l
	return s.browser, nil
}

func (s *Service) Close() {
	s.FlushAllZipWrites()

	s.activeRunsMu.Lock()
	for _, run := range s.activeRuns {
		if run.Cancel != nil {
			run.Cancel()
		}
		if run.Page != nil {
			_ = run.Page.Close()
			run.Page = nil
		}
	}
	browser := s.browser
	launcher := s.launcher
	s.browser = nil
	s.launcher = nil
	s.activeRunsMu.Unlock()

	if browser != nil {
		_ = browser.Close()
	}
	if launcher != nil {
		launcher.Kill()
	}
}

func (s *Service) NewJSSession(logWriter io.Writer, runID string) (*JSSession, error) {
	browser, err := s.getBrowser()
	if err != nil {
		return nil, err
	}

	page := stealth.MustPage(browser)
	_ = proto.NetworkEnable{}.Call(page)
	_ = page.SetViewport(&proto.EmulationSetDeviceMetricsOverride{
		Width:             1024,
		Height:            768,
		DeviceScaleFactor: 1,
	})

	s.activeRunsMu.Lock()
	if run, ok := s.activeRuns[runID]; ok {
		run.Page = page
	}
	s.activeRunsMu.Unlock()

	jar, _ := cookiejar.New(nil)
	return &JSSession{
		svc:       s,
		logWriter: logWriter,
		runID:     runID,
		page:      page,
		jar:       jar,
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
	status := 200
	respHeaders := make(map[string]string)
	var navMu sync.Mutex
	responsePage, stopResponseCapture := s.page.WithCancel()
	defer stopResponseCapture()
	go responsePage.EachEvent(func(e *proto.NetworkResponseReceived) {
		if e.Type != proto.NetworkResourceTypeDocument || e.Response == nil {
			return
		}
		navMu.Lock()
		status = e.Response.Status
		respHeaders = networkHeadersToStringMap(e.Response.Headers)
		navMu.Unlock()
	})()
	err := s.page.Navigate(urlStr)
	if err != nil {
		return nil, fmt.Errorf("lỗi điều hướng: %w", err)
	}
	loadPage := s.page.Timeout(30 * time.Second)
	if err := loadPage.WaitLoad(); err != nil && s.logWriter != nil {
		fmt.Fprintf(s.logWriter, "[*] Không chờ được sự kiện load hoàn tất, tiếp tục đọc DOM hiện tại: %v\n", err)
	}
	loadPage.CancelTimeout()
	stopResponseCapture()
	navMu.Lock()
	finalStatus := status
	finalHeaders := respHeaders
	navMu.Unlock()

	_ = s.page.WaitDOMStable(1000*time.Millisecond, 0.5)

	s.handleCloudflareChallenge()

	htmlBody := s.page.MustHTML()
	return &JSSessionResponse{
		Status:  finalStatus,
		Body:    htmlBody,
		Headers: finalHeaders,
	}, nil
}

func networkHeadersToStringMap(headers proto.NetworkHeaders) map[string]string {
	out := make(map[string]string)
	for k, v := range headers {
		out[strings.ToLower(k)] = v.String()
	}
	return out
}

func (s *JSSession) Post(urlStr string, payload any, headers map[string]string) (*JSSessionResponse, error) {
	resp, err := s.fetchInPage(urlStr, "POST", headers, payload)
	if err == nil {
		return resp, nil
	}
	if !isFormURLEncoded(headers) || !strings.Contains(err.Error(), "Failed to fetch") {
		return nil, err
	}
	if s.logWriter != nil {
		fmt.Fprintln(s.logWriter, "[*] POST bằng fetch bị trình duyệt chặn, chuyển sang submit form...")
	}
	return s.submitFormInPage(urlStr, payload)
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

func (s *JSSession) GetFast(urlStr string, headers map[string]string) (*JSSessionResponse, error) {
	resp, err := s.requestFast("GET", urlStr, nil, headers)
	if err != nil || isCloudflareResponse(resp) {
		if s.logWriter != nil {
			var reason string
			if err != nil {
				reason = fmt.Sprintf("lỗi (%v)", err)
			} else if resp != nil {
				reason = fmt.Sprintf("phát hiện Cloudflare (Status: %d)", resp.Status)
			} else {
				reason = "không phản hồi"
			}
			fmt.Fprintf(s.logWriter, "  [*] GetFast thất bại do %s, chuyển sang dùng trình duyệt ảo: %s\n", reason, urlStr)
		}
		return s.Get(urlStr, headers)
	}
	return resp, nil
}

func (s *JSSession) PostFast(urlStr string, payload any, headers map[string]string) (*JSSessionResponse, error) {
	resp, err := s.requestFast("POST", urlStr, payload, headers)
	if err != nil || isCloudflareResponse(resp) {
		if s.logWriter != nil {
			var reason string
			if err != nil {
				reason = fmt.Sprintf("lỗi (%v)", err)
			} else if resp != nil {
				reason = fmt.Sprintf("phát hiện Cloudflare (Status: %d)", resp.Status)
			} else {
				reason = "không phản hồi"
			}
			fmt.Fprintf(s.logWriter, "  [*] PostFast thất bại do %s, chuyển sang dùng trình duyệt ảo: %s\n", reason, urlStr)
		}
		return s.Post(urlStr, payload, headers)
	}
	return resp, nil
}

func isCloudflareResponse(resp *JSSessionResponse) bool {
	if resp == nil {
		return true
	}
	if resp.Status == 403 || resp.Status == 503 || resp.Status == 429 {
		return true
	}
	html := resp.Body
	if strings.Contains(html, "challenge-form") ||
		strings.Contains(html, "/cdn-cgi/challenge-platform/") ||
		strings.Contains(html, "cf-challenge") ||
		strings.Contains(html, "cf-turnstile") ||
		strings.Contains(html, "Just a moment...") ||
		strings.Contains(html, "turnstile-wrapper") {
		return true
	}
	return false
}

func (s *JSSession) requestFast(method string, urlStr string, payload any, headers map[string]string) (*JSSessionResponse, error) {
	client := &http.Client{
		Timeout: 30 * time.Second,
		Jar:     s.jar,
	}

	// 1. Đồng bộ cookies từ Chrome ảo vào Go CookieJar trước khi request
	parsedURL, _ := url.Parse(urlStr)
	if parsedURL != nil {
		cookies, cerr := s.page.Cookies(nil)
		if cerr == nil && len(cookies) > 0 {
			var httpCookies []*http.Cookie
			for _, c := range cookies {
				domain := c.Domain
				if domain == "" {
					domain = parsedURL.Hostname()
				}
				httpCookies = append(httpCookies, &http.Cookie{
					Name:   c.Name,
					Value:  c.Value,
					Domain: domain,
					Path:   c.Path,
				})
			}
			s.jar.SetCookies(parsedURL, httpCookies)
		}
	}

	var bodyReader io.Reader
	if payload != nil && method == "POST" {
		if isFormURLEncoded(headers) {
			formValues, ok := payloadToStringMap(payload)
			if ok {
				data := url.Values{}
				for k, v := range formValues {
					data.Set(k, v)
				}
				bodyReader = strings.NewReader(data.Encode())
			}
		} else {
			jsonData, err := json.Marshal(payload)
			if err == nil {
				bodyReader = bytes.NewReader(jsonData)
			}
		}
	}

	req, err := http.NewRequest(method, urlStr, bodyReader)
	if err != nil {
		return nil, fmt.Errorf("lỗi tạo request thô: %w", err)
	}

	for k, v := range headers {
		req.Header.Set(k, v)
	}
	if req.Header.Get("User-Agent") == "" {
		req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
	}

	resp, err := client.Do(req)
	if err != nil {
		if altServerName := tlsAlternativeServerName(err); altServerName != "" {
			if s.logWriter != nil {
				fmt.Fprintf(s.logWriter, "  [*] (Fast) Phát hiện lỗi chứng chỉ tên miền (%s), thử lại với SNI %s...\n", req.URL.Host, altServerName)
			}
			retryReq := req.Clone(req.Context())
			if payload != nil && method == "POST" {
				if isFormURLEncoded(headers) {
					formValues, _ := payloadToStringMap(payload)
					data := url.Values{}
					for k, v := range formValues {
						data.Set(k, v)
					}
					retryReq.Body = io.NopCloser(strings.NewReader(data.Encode()))
				} else {
					jsonData, _ := json.Marshal(payload)
					retryReq.Body = io.NopCloser(bytes.NewReader(jsonData))
				}
			}
			retryClient := &http.Client{
				Timeout: 30 * time.Second,
				Jar:     s.jar,
				Transport: &http.Transport{
					Proxy:           http.ProxyFromEnvironment,
					TLSClientConfig: &tls.Config{ServerName: altServerName},
				},
			}
			resp, err = retryClient.Do(retryReq)
		}

		if err != nil {
			return nil, fmt.Errorf("lỗi request thô: %w", err)
		}
	}
	defer resp.Body.Close()

	bodyBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("lỗi đọc phản hồi thô: %w", err)
	}

	// 2. Đồng bộ ngược lại cookies từ Go CookieJar vào Chrome ảo sau khi nhận response
	if parsedURL != nil {
		httpCookies := s.jar.Cookies(parsedURL)
		if len(httpCookies) > 0 {
			var protoCookies []*proto.NetworkCookieParam
			for _, c := range httpCookies {
				domain := c.Domain
				if domain == "" {
					domain = parsedURL.Hostname()
				}
				expires := proto.TimeSinceEpoch(c.Expires.Unix())
				protoCookies = append(protoCookies, &proto.NetworkCookieParam{
					Name:     c.Name,
					Value:    c.Value,
					Domain:   domain,
					Path:     c.Path,
					Secure:   c.Secure,
					HTTPOnly: c.HttpOnly,
					Expires:  expires,
				})
			}
			_ = s.page.SetCookies(protoCookies)
		}
	}

	respHeaders := make(map[string]string)
	for k, v := range resp.Header {
		if len(v) > 0 {
			respHeaders[strings.ToLower(k)] = v[0]
		}
	}

	return &JSSessionResponse{
		Status:  resp.StatusCode,
		Body:    string(bodyBytes),
		Headers: respHeaders,
	}, nil
}

func isFormURLEncoded(headers map[string]string) bool {
	for k, v := range headers {
		if strings.ToLower(k) == "content-type" && strings.Contains(strings.ToLower(v), "application/x-www-form-urlencoded") {
			return true
		}
	}
	return false
}

func payloadToStringMap(payload any) (map[string]string, bool) {
	values := make(map[string]string)
	switch m := payload.(type) {
	case map[string]any:
		for k, v := range m {
			values[k] = fmt.Sprintf("%v", v)
		}
	case map[string]string:
		maps.Copy(values, m)
	default:
		return nil, false
	}
	return values, true
}

func (s *JSSession) submitFormInPage(urlStr string, payload any) (*JSSessionResponse, error) {
	fields, ok := payloadToStringMap(payload)
	if !ok {
		return nil, errors.New("không thể submit form: payload không phải object")
	}
	fieldsJSON, err := json.Marshal(fields)
	if err != nil {
		return nil, err
	}

	formScript := `
		(url, fieldsJson) => {
			const fields = JSON.parse(fieldsJson);
			const form = document.createElement("form");
			form.method = "POST";
			form.action = url;
			form.style.display = "none";
			for (const [key, value] of Object.entries(fields)) {
				const input = document.createElement("input");
				input.type = "hidden";
				input.name = key;
				input.value = String(value);
				form.appendChild(input);
			}
			document.body.appendChild(form);
			form.submit();
			return true;
		}
	`

	navPage := s.page.Timeout(30 * time.Second)
	defer navPage.CancelTimeout()
	wait := navPage.WaitNavigation(proto.PageLifecycleEventNameLoad)

	if _, err := navPage.Evaluate(rod.Eval(formScript, urlStr, string(fieldsJSON))); err != nil {
		return nil, fmt.Errorf("lỗi submit form trong trang: %w", err)
	}
	if err := rod.Try(func() { wait() }); err != nil && s.logWriter != nil {
		fmt.Fprintf(s.logWriter, "[*] Không bắt được sự kiện điều hướng sau submit form, tiếp tục đọc trang hiện tại: %v\n", err)
	}

	_ = s.page.WaitDOMStable(1000*time.Millisecond, 0.5)
	s.handleCloudflareChallenge()

	htmlBody, err := s.page.HTML()
	if err != nil {
		return nil, fmt.Errorf("lỗi đọc HTML sau submit form: %w", err)
	}
	return &JSSessionResponse{
		Status:  200,
		Body:    htmlBody,
		Headers: make(map[string]string),
	}, nil
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
		if altServerName := tlsAlternativeServerName(err); altServerName != "" {
			if s.logWriter != nil {
				fmt.Fprintf(s.logWriter, "  [*] Phát hiện lỗi chứng chỉ tên miền (%s), thử lại với SNI %s...\n", req.URL.Host, altServerName)
			}
			retryReq := req.Clone(req.Context())
			retryClient := &http.Client{
				Timeout: 30 * time.Second,
				Transport: &http.Transport{
					Proxy:           http.ProxyFromEnvironment,
					TLSClientConfig: &tls.Config{ServerName: altServerName},
				},
			}
			resp, err = retryClient.Do(retryReq)
			if err == nil {
				goto readResponse
			}
		}
		if browserBase64, browserErr := s.getBinaryBase64InPage(urlStr, headers); browserErr == nil && browserBase64 != "" {
			return browserBase64, nil
		}
		return "", fmt.Errorf("lỗi tải ảnh nhị phân: %w", err)
	}
readResponse:
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		if browserBase64, browserErr := s.getBinaryBase64InPage(urlStr, headers); browserErr == nil && browserBase64 != "" {
			return browserBase64, nil
		}
		return "", fmt.Errorf("lỗi tải ảnh nhị phân: HTTP %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		if browserBase64, browserErr := s.getBinaryBase64InPage(urlStr, headers); browserErr == nil && browserBase64 != "" {
			return browserBase64, nil
		}
		return "", fmt.Errorf("lỗi đọc dữ liệu ảnh: %w", err)
	}

	return base64.StdEncoding.EncodeToString(body), nil
}

func (s *JSSession) GetBinariesBase64(urlsVal any, headers map[string]string) (map[string]string, error) {
	var urls []string
	switch v := urlsVal.(type) {
	case []string:
		urls = v
	case []any:
		for _, val := range v {
			if str, ok := val.(string); ok {
				urls = append(urls, str)
			}
		}
	default:
		return nil, fmt.Errorf("đầu vào urls phải là một mảng")
	}

	results := make(map[string]string)
	var mu sync.Mutex

	sem := make(chan struct{}, 8)
	var wg sync.WaitGroup

	for _, u := range urls {
		wg.Add(1)
		go func(urlStr string) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()

			base64Data, err := s.GetBinaryBase64(urlStr, headers)
			if err != nil {
				if s.logWriter != nil {
					fmt.Fprintf(s.logWriter, "  [!] Tải ảnh thất bại: %s (%v)\n", urlStr, err)
				}
				return
			}

			mu.Lock()
			results[urlStr] = base64Data
			mu.Unlock()
		}(u)
	}
	wg.Wait()
	return results, nil
}

func (s *JSSession) getBinaryBase64InPage(urlStr string, headers map[string]string) (string, error) {
	if s == nil || s.page == nil {
		return "", errors.New("không có browser session để tải ảnh")
	}
	fetchScript := `
		async (url, headersJson) => {
			const headers = JSON.parse(headersJson || "{}");
			const resp = await fetch(url, { headers });
			if (!resp.ok) {
				throw new Error("HTTP " + resp.status);
			}
			const bytes = new Uint8Array(await resp.arrayBuffer());
			let binary = "";
			const chunkSize = 0x8000;
			for (let i = 0; i < bytes.length; i += chunkSize) {
				binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
			}
			return btoa(binary);
		}
	`
	headersBytes, _ := json.Marshal(headers)
	res, err := s.page.Evaluate(rod.Eval(fetchScript, urlStr, string(headersBytes)).ByPromise())
	if err != nil {
		return "", fmt.Errorf("lỗi tải ảnh bằng browser fetch: %w", err)
	}
	var base64Str string
	if err := res.Value.Unmarshal(&base64Str); err != nil {
		return "", fmt.Errorf("lỗi đọc dữ liệu ảnh từ browser fetch: %w", err)
	}
	return base64Str, nil
}

func tlsAlternativeServerName(err error) string {
	var hostnameErr x509.HostnameError
	if errors.As(err, &hostnameErr) && hostnameErr.Certificate != nil {
		if len(hostnameErr.Certificate.DNSNames) > 0 {
			return hostnameErr.Certificate.DNSNames[0]
		}
		if hostnameErr.Certificate.Subject.CommonName != "" {
			return hostnameErr.Certificate.Subject.CommonName
		}
	}
	return ""
}

func (s *JSSession) isCloudflareActive() bool {
	info, err := s.page.Info()
	if err != nil {
		return false
	}
	title := strings.TrimSpace(info.Title)

	isTitleCF := title == "Just a moment..." || title == "Cloudflare"

	var isDomCF bool
	res, err := s.page.Evaluate(rod.Eval(`() => {
		if (window._cf_chl_opt) return true;
		const form = document.getElementById('challenge-form');
		if (form && form.action && form.action.includes('/cdn-cgi/')) return true;
		if (document.querySelector('script[src*="/cdn-cgi/challenge-platform/"]')) return true;
		if (document.getElementById('cf-challenge') || document.querySelector('.cf-challenge') || document.getElementById('turnstile-wrapper')) return true;
		return false;
	}`))
	if err == nil && res != nil {
		_ = res.Value.Unmarshal(&isDomCF)
	}

	if !isDomCF && !isTitleCF {
		return false
	}

	html, err := s.page.HTML()
	if err != nil {
		return false
	}
	if isVisibleLoginFormHTML(html) {
		return false
	}

	return true
}

func isVisibleLoginFormHTML(html string) bool {
	lower := strings.ToLower(html)
	return strings.Contains(lower, "<form") &&
		strings.Contains(lower, "/login") &&
		strings.Contains(lower, `name="password"`) &&
		(strings.Contains(lower, `name="name"`) || strings.Contains(lower, `name="email"`) || strings.Contains(lower, `autocomplete="username"`))
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
	imgBytes, err := s.page.Screenshot(false, &proto.PageCaptureScreenshot{
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
	_ = os.MkdirAll(filepath.Join(dir, "origin"), 0755)
	return dir
}

func (s *Service) extensionOriginDir() string {
	dir := filepath.Join(s.extensionsDir(), "origin")
	_ = os.MkdirAll(dir, 0755)
	return dir
}

func (s *Service) EnsureExtensionWorkspace() error {
	originDir := s.extensionOriginDir()
	entries, err := embeddedextensions.FS.ReadDir("origin")
	if err != nil {
		return err
	}
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(strings.ToLower(entry.Name()), ".js") {
			continue
		}
		data, err := embeddedextensions.FS.ReadFile(filepath.ToSlash(filepath.Join("origin", entry.Name())))
		if err != nil {
			return err
		}
		dst := filepath.Join(originDir, entry.Name())
		if _, err := os.Stat(dst); err == nil {
			continue
		}
		if err := os.WriteFile(dst, data, 0644); err != nil {
			return err
		}
	}
	return nil
}

type localExtensionFile struct {
	path   string
	origin bool
}

func (s *Service) localExtensionFiles() []localExtensionFile {
	rootDir := s.extensionsDir()
	originDir := s.extensionOriginDir()
	var files []localExtensionFile
	for _, source := range []struct {
		dir    string
		origin bool
	}{
		{dir: originDir, origin: true},
		{dir: rootDir},
	} {
		entries, err := os.ReadDir(source.dir)
		if err != nil {
			continue
		}
		for _, entry := range entries {
			if entry.IsDir() || !strings.HasSuffix(strings.ToLower(entry.Name()), ".js") {
				continue
			}
			files = append(files, localExtensionFile{
				path:   filepath.Join(source.dir, entry.Name()),
				origin: source.origin,
			})
		}
	}
	return files
}

func (s *Service) extensionFilePath(id string) string {
	fileName := id + ".js"
	originPath := filepath.Join(s.extensionOriginDir(), fileName)
	if _, err := os.Stat(originPath); err == nil {
		return originPath
	}
	return filepath.Join(s.extensionsDir(), fileName)
}

func (s *Service) ListExtensions() ([]ExtensionInfo, error) {
	storeMap := s.getStoreMd5Map()

	var list []ExtensionInfo
	seen := make(map[string]bool)
	for _, file := range s.localExtensionFiles() {
		jsBytes, err := os.ReadFile(file.path)
		if err != nil {
			continue
		}

		info, err := s.parseExtensionMeta(string(jsBytes))
		if err != nil {
			continue
		}
		if seen[info.ID] {
			continue
		}
		seen[info.ID] = true

		info.Md5 = computeMD5(jsBytes)

		if file.origin {
			info.IsOfficial = true
		}
		if remoteMd5, ok := storeMap[info.ID]; ok {
			info.IsOfficial = true
			if remoteMd5 != "" && remoteMd5 != info.Md5 {
				info.HasUpdate = true
			}
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

const storeAPIURL = "https://api.github.com/repos/AzenKain/EPUB-Forge/contents/extensions/origin"

type githubContentEntry struct {
	Name        string `json:"name"`
	Path        string `json:"path"`
	Size        int64  `json:"size"`
	DownloadURL string `json:"download_url"`
}

type storeCacheEntry struct {
	items     []StoreExtensionInfo
	md5Map    map[string]string
	fetchedAt time.Time
}

var (
	storeCache   *storeCacheEntry
	storeCacheMu sync.Mutex
)

const storeCacheTTL = 5 * time.Minute

func (s *Service) getStoreMd5Map() map[string]string {
	storeCacheMu.Lock()
	defer storeCacheMu.Unlock()
	if storeCache != nil && time.Since(storeCache.fetchedAt) < storeCacheTTL {
		return storeCache.md5Map
	}
	return make(map[string]string)
}

func (s *Service) FetchStoreExtensions() ([]StoreExtensionInfo, error) {
	storeCacheMu.Lock()
	if storeCache != nil && time.Since(storeCache.fetchedAt) < storeCacheTTL {
		cached := storeCache.items
		storeCacheMu.Unlock()
		return s.tagStoreWithLocalState(cached), nil
	}
	storeCacheMu.Unlock()

	client := &http.Client{Timeout: 15 * time.Second}
	storeURL := storeAPIURL
	if strings.Contains(storeURL, "?") {
		storeURL += fmt.Sprintf("&_t=%d", time.Now().UnixNano())
	} else {
		storeURL += fmt.Sprintf("?_t=%d", time.Now().UnixNano())
	}
	req, err := http.NewRequest("GET", storeURL, nil)
	if err != nil {
		return nil, fmt.Errorf("không thể tạo request tới GitHub: %w", err)
	}
	req.Header.Set("Accept", "application/vnd.github.v3+json")
	req.Header.Set("User-Agent", "EPUBForge-ExtensionStore")
	req.Header.Set("Cache-Control", "no-cache, no-store, must-revalidate")
	req.Header.Set("Pragma", "no-cache")

	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("không thể kết nối tới GitHub: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("GitHub API trả về lỗi: HTTP %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("lỗi đọc phản hồi từ GitHub: %w", err)
	}

	var entries []githubContentEntry
	if err := json.Unmarshal(body, &entries); err != nil {
		return nil, fmt.Errorf("lỗi phân giải danh sách extension từ GitHub: %w", err)
	}

	var storeItems []StoreExtensionInfo
	md5Map := make(map[string]string)

	for _, entry := range entries {
		if !strings.HasSuffix(strings.ToLower(entry.Name), ".js") || entry.DownloadURL == "" {
			continue
		}

		jsBytes, err := s.downloadRawFile(entry.DownloadURL)
		if err != nil {
			continue
		}

		info, err := s.parseExtensionMeta(string(jsBytes))
		if err != nil {
			continue
		}

		fileMd5 := computeMD5(jsBytes)
		md5Map[info.ID] = fileMd5

		storeItems = append(storeItems, StoreExtensionInfo{
			ID:          info.ID,
			Name:        info.Name,
			Description: info.Description,
			Inputs:      info.Inputs,
			Md5:         fileMd5,
			DownloadURL: entry.DownloadURL,
			Size:        entry.Size,
		})
	}

	storeCacheMu.Lock()
	storeCache = &storeCacheEntry{
		items:     storeItems,
		md5Map:    md5Map,
		fetchedAt: time.Now(),
	}
	storeCacheMu.Unlock()

	return s.tagStoreWithLocalState(storeItems), nil
}

func (s *Service) tagStoreWithLocalState(items []StoreExtensionInfo) []StoreExtensionInfo {
	localMd5s := make(map[string]string)

	for _, file := range s.localExtensionFiles() {
		jsBytes, err := os.ReadFile(file.path)
		if err != nil {
			continue
		}
		info, err := s.parseExtensionMeta(string(jsBytes))
		if err != nil {
			continue
		}
		if _, exists := localMd5s[info.ID]; !exists {
			localMd5s[info.ID] = computeMD5(jsBytes)
		}
	}

	result := make([]StoreExtensionInfo, len(items))
	for i, item := range items {
		result[i] = item
		if localMd5, ok := localMd5s[item.ID]; ok {
			result[i].Installed = true
			if localMd5 != item.Md5 {
				result[i].HasUpdate = true
			}
		}
	}
	return result
}

func (s *Service) downloadRawFile(rawURL string) ([]byte, error) {
	client := &http.Client{Timeout: 30 * time.Second}
	targetURL := rawURL
	if strings.Contains(targetURL, "?") {
		targetURL += fmt.Sprintf("&_t=%d", time.Now().UnixNano())
	} else {
		targetURL += fmt.Sprintf("?_t=%d", time.Now().UnixNano())
	}
	req, err := http.NewRequest("GET", targetURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "EPUBForge-ExtensionStore")
	req.Header.Set("Cache-Control", "no-cache, no-store, must-revalidate")
	req.Header.Set("Pragma", "no-cache")

	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	return io.ReadAll(resp.Body)
}

func (s *Service) InstallStoreExtension(downloadURL string) (ExtensionInfo, error) {
	jsBytes, err := s.downloadRawFile(downloadURL)
	if err != nil {
		return ExtensionInfo{}, fmt.Errorf("không thể tải extension từ store: %w", err)
	}
	return s.addExtensionToDir(jsBytes, s.extensionOriginDir())
}

func (s *Service) UpdateExtension(id string) (ExtensionInfo, error) {
	storeItems, err := s.FetchStoreExtensions()
	if err != nil {
		return ExtensionInfo{}, fmt.Errorf("không thể truy vấn store: %w", err)
	}

	var downloadURL string
	for _, item := range storeItems {
		if item.ID == id {
			downloadURL = item.DownloadURL
			break
		}
	}

	if downloadURL == "" {
		return ExtensionInfo{}, fmt.Errorf("extension %q không tìm thấy trên store", id)
	}

	jsBytes, err := s.downloadRawFile(downloadURL)
	if err != nil {
		return ExtensionInfo{}, fmt.Errorf("không thể tải bản cập nhật: %w", err)
	}

	storeCacheMu.Lock()
	storeCache = nil
	storeCacheMu.Unlock()

	return s.addExtensionToDir(jsBytes, s.extensionOriginDir())
}

func formatJSPanic(vm *goja.Runtime, recovered any) error {
	switch v := recovered.(type) {
	case *goja.Exception:
		message := jsExceptionMessage(vm, v)
		if message != "" {
			return errors.New(message)
		}
		return errors.New(v.String())
	case error:
		if errors.Is(v, context.Canceled) {
			return context.Canceled
		}
		return fmt.Errorf("JS execution panic: %v", v)
	default:
		return fmt.Errorf("JS execution panic: %v", v)
	}
}

func jsExceptionMessage(vm *goja.Runtime, ex *goja.Exception) string {
	if ex == nil {
		return ""
	}
	val := ex.Value()
	if val == nil || goja.IsUndefined(val) || goja.IsNull(val) {
		return strings.TrimSpace(ex.String())
	}

	obj := val.ToObject(vm)
	if obj != nil {
		messageVal := obj.Get("message")
		if messageVal != nil && !goja.IsUndefined(messageVal) && !goja.IsNull(messageVal) {
			if message := strings.TrimSpace(messageVal.String()); message != "" {
				return message
			}
		}
	}

	text := strings.TrimSpace(val.String())
	text = strings.TrimPrefix(text, "Error: ")
	if text != "" {
		return text
	}
	return strings.TrimSpace(ex.String())
}

func (s *Service) waitForExtensionChoice(ctx context.Context, run *ActiveRun, logWriter io.Writer, prompt string, rawOptions any, multiple bool) ([]string, error) {
	options := normalizeExtensionChoiceOptions(rawOptions)
	if len(options) == 0 {
		return nil, errors.New("choice prompt không có lựa chọn nào")
	}

	choiceID := "choice_" + randomID()
	ch := make(chan []string, 1)

	run.ChoiceMu.Lock()
	run.ChoiceID = choiceID
	run.ChoiceCh = ch
	run.ChoiceMu.Unlock()

	defer func() {
		run.ChoiceMu.Lock()
		if run.ChoiceID == choiceID {
			run.ChoiceID = ""
			run.ChoiceCh = nil
		}
		run.ChoiceMu.Unlock()
	}()

	msg := map[string]any{
		"type":     "choice_required",
		"runId":    run.SessionID,
		"choiceId": choiceID,
		"prompt":   prompt,
		"multiple": multiple,
		"options":  options,
	}
	msgBytes, _ := json.Marshal(msg)
	fmt.Fprintln(logWriter, string(msgBytes))

	select {
	case selected := <-ch:
		if !multiple && len(selected) > 1 {
			selected = selected[:1]
		}
		return selected, nil
	case <-ctx.Done():
		return nil, context.Canceled
	}
}

func normalizeExtensionChoiceOptions(rawOptions any) []extensionChoiceOption {
	var options []extensionChoiceOption
	switch items := rawOptions.(type) {
	case []any:
		for i, item := range items {
			options = appendChoiceOption(options, i, item)
		}
	case []map[string]any:
		for i, item := range items {
			options = appendChoiceOption(options, i, item)
		}
	case []extensionChoiceOption:
		return items
	}
	return options
}

func appendChoiceOption(options []extensionChoiceOption, index int, item any) []extensionChoiceOption {
	switch v := item.(type) {
	case map[string]any:
		id := strings.TrimSpace(fmt.Sprintf("%v", v["id"]))
		label := strings.TrimSpace(fmt.Sprintf("%v", v["label"]))
		description := strings.TrimSpace(fmt.Sprintf("%v", v["description"]))
		if id == "" || id == "<nil>" {
			id = strconv.Itoa(index + 1)
		}
		if label == "" || label == "<nil>" {
			label = id
		}
		if description == "<nil>" {
			description = ""
		}
		return append(options, extensionChoiceOption{ID: id, Label: label, Description: description})
	case map[string]string:
		id := strings.TrimSpace(v["id"])
		label := strings.TrimSpace(v["label"])
		description := strings.TrimSpace(v["description"])
		if id == "" {
			id = strconv.Itoa(index + 1)
		}
		if label == "" {
			label = id
		}
		return append(options, extensionChoiceOption{ID: id, Label: label, Description: description})
	case string:
		id := strconv.Itoa(index + 1)
		return append(options, extensionChoiceOption{ID: id, Label: v})
	default:
		label := strings.TrimSpace(fmt.Sprintf("%v", v))
		if label == "" || label == "<nil>" {
			label = strconv.Itoa(index + 1)
		}
		return append(options, extensionChoiceOption{ID: strconv.Itoa(index + 1), Label: label})
	}
}

func (s *Service) RunExtension(ctx context.Context, id string, inputs map[string]any, logWriter io.Writer) ([]string, []string, error) {
	filePath := s.extensionFilePath(id)
	if _, err := os.Stat(filePath); os.IsNotExist(err) {
		return nil, nil, fmt.Errorf("extension %q not found", id)
	}

	jsBytes, err := os.ReadFile(filePath)
	if err != nil {
		return nil, nil, err
	}

	runID := "run_" + randomID()
	runCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	activeRun := &ActiveRun{
		SessionID: runID,
		Cancel:    cancel,
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
		"choose": func(prompt string, options any, multiple bool) []string {
			selected, err := s.waitForExtensionChoice(runCtx, activeRun, logWriter, prompt, options, multiple)
			if err != nil {
				panic(err)
			}
			return selected
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
		return nil, nil, fmt.Errorf("lỗi khởi tạo script: %w", err)
	}

	var runFunc func(map[string]any) any
	err = vm.ExportTo(vm.Get("run"), &runFunc)
	if err != nil {
		return nil, nil, errors.New("missing run(params) function in script")
	}

	fmt.Fprintf(logWriter, "[*] Đang thực thi mã nguồn Extension...\n")

	doneChan := make(chan struct{})
	defer close(doneChan)

	go func() {
		select {
		case <-runCtx.Done():
			vm.Interrupt(context.Canceled)
		case <-doneChan:
		}
	}()

	var result any
	errChan := make(chan error, 1)
	go func() {
		defer func() {
			if r := recover(); r != nil {
				errChan <- formatJSPanic(vm, r)
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
				return nil, nil, err
			}
			return nil, nil, err
		}
	case <-runCtx.Done():
		return nil, nil, context.Canceled
	}

	if result == nil {
		return nil, nil, errors.New("kết quả trả về từ extension rỗng (null/undefined)")
	}

	var warnings []string
	if mapRes, ok := result.(map[string]any); ok {
		if warningsVal, ok := mapRes["warnings"]; ok {
			if sliceVal, ok := warningsVal.([]any); ok {
				for _, item := range sliceVal {
					if ws, ok := item.(string); ok {
						warnings = append(warnings, ws)
					}
				}
			} else if sliceVal, ok := warningsVal.([]string); ok {
				warnings = append(warnings, sliceVal...)
			}
		}
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
		return nil, nil, errors.New("dữ liệu trả về không hợp lệ, không tìm thấy thông tin sách")
	}

	var createdBooks []string
	for _, m := range ebooks {
		jsonBytes, err := json.Marshal(m)
		if err != nil {
			return nil, nil, fmt.Errorf("lỗi đóng gói kết quả: %w", err)
		}

		var req models.CreateEpubRequest
		if err := json.Unmarshal(jsonBytes, &req); err != nil {
			return nil, nil, fmt.Errorf("dữ liệu trả về không khớp cấu trúc EPUB: %w", err)
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
			return nil, nil, fmt.Errorf("lỗi biên dịch EPUB: %w", err)
		}
		fmt.Fprintf(logWriter, "[*] Đã tự kiểm tra và sửa EPUB trước khi lưu: %s\n", outputName)
		createdBooks = append(createdBooks, outputName)
	}

	outputNamesStr := strings.Join(createdBooks, ", ")
	fmt.Fprintf(logWriter, "[+] Đã tạo sách thành công: %s\n", outputNamesStr)
	return createdBooks, warnings, nil
}

func (s *Service) AddExtension(jsCode []byte) (ExtensionInfo, error) {
	return s.addExtensionToDir(jsCode, s.extensionsDir())
}

func (s *Service) addExtensionToDir(jsCode []byte, dir string) (ExtensionInfo, error) {
	info, err := s.parseExtensionMeta(string(jsCode))
	if err != nil {
		return ExtensionInfo{}, fmt.Errorf("extension không hợp lệ: %w", err)
	}

	filePath := filepath.Join(dir, info.ID+".js")
	if err := os.WriteFile(filePath, jsCode, 0644); err != nil {
		return ExtensionInfo{}, fmt.Errorf("không thể ghi file extension: %w", err)
	}

	return info, nil
}

func (s *Service) DeleteExtension(id string) error {
	filePath := s.extensionFilePath(id)
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

	if action == "choice" {
		return "", answerExtensionChoice(run, text)
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
	imgBytes, err := run.Page.Screenshot(false, &proto.PageCaptureScreenshot{
		Format:  proto.PageCaptureScreenshotFormatJpeg,
		Quality: &quality,
	})
	if err != nil {
		return "", fmt.Errorf("không thể chụp màn hình: %w", err)
	}

	return "data:image/jpeg;base64," + base64.StdEncoding.EncodeToString(imgBytes), nil
}

func answerExtensionChoice(run *ActiveRun, text string) error {
	var selected []string
	if err := json.Unmarshal([]byte(text), &selected); err != nil {
		for _, part := range strings.Split(text, ",") {
			part = strings.TrimSpace(part)
			if part != "" {
				selected = append(selected, part)
			}
		}
	}
	if len(selected) == 0 {
		return errors.New("chưa chọn lựa chọn nào")
	}

	run.ChoiceMu.Lock()
	ch := run.ChoiceCh
	run.ChoiceMu.Unlock()
	if ch == nil {
		return errors.New("không có yêu cầu chọn nào đang chờ")
	}

	select {
	case ch <- selected:
		return nil
	default:
		return errors.New("yêu cầu chọn đã được xử lý")
	}
}

func (s *Service) AutoUpdateExtensions() {
	log.Printf("[Extensions] Đang kiểm tra cập nhật các tiện ích mở rộng từ store...")

	storeItems, err := s.FetchStoreExtensions()
	if err != nil {
		log.Printf("[Extensions] Không thể tải danh sách tiện ích từ store: %v", err)
		return
	}

	list, err := s.ListExtensions()
	if err != nil {
		log.Printf("[Extensions] Không thể lấy danh sách tiện ích cục bộ: %v", err)
		return
	}

	updatedCount := 0
	for _, ext := range list {
		if ext.HasUpdate && ext.IsOfficial {
			log.Printf("[Extensions] Phát hiện bản cập nhật mới cho %s (%s). Đang tải...", ext.Name, ext.ID)

			var downloadURL string
			for _, item := range storeItems {
				if item.ID == ext.ID {
					downloadURL = item.DownloadURL
					break
				}
			}

			if downloadURL == "" {
				continue
			}

			jsBytes, err := s.downloadRawFile(downloadURL)
			if err != nil {
				log.Printf("[Extensions] Lỗi khi tải bản cập nhật cho %s: %v", ext.ID, err)
				continue
			}

			_, err = s.addExtensionToDir(jsBytes, s.extensionOriginDir())
			if err != nil {
				log.Printf("[Extensions] Lỗi khi cài đặt bản cập nhật cho %s: %v", ext.ID, err)
			} else {
				log.Printf("[Extensions] Đã cập nhật thành công tiện ích %s!", ext.Name)
				updatedCount++
			}
		}
	}

	if updatedCount > 0 {
		// Invalidate store cache since local state changed
		storeCacheMu.Lock()
		storeCache = nil
		storeCacheMu.Unlock()
		log.Printf("[Extensions] Đã tự động cập nhật thành công %d tiện ích mở rộng.", updatedCount)
	} else {
		log.Printf("[Extensions] Tất cả tiện ích mở rộng đã ở phiên bản mới nhất.")
	}
}
