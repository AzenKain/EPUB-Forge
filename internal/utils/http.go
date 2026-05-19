package utils

import (
	"bytes"
	"encoding/json"
	"io"
	"io/fs"
	"log"
	"net/http"
	"os"
	"os/exec"
	"runtime"
)

func ServeEmbeddedFile(w http.ResponseWriter, r *http.Request, dist fs.FS, name string) bool {
	file, err := dist.Open(name)
	if err != nil {
		return false
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil || info.IsDir() {
		return false
	}
	data, err := io.ReadAll(file)
	if err != nil {
		return false
	}
	http.ServeContent(w, r, name, info.ModTime(), bytes.NewReader(data))
	return true
}

func WriteJSON(w http.ResponseWriter, value any, err error) {
	if err != nil {
		WriteError(w, err)
		return
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	_ = json.NewEncoder(w).Encode(value)
}

func WriteError(w http.ResponseWriter, err error) {
	log.Println(err)
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(http.StatusInternalServerError)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
}

func Env(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

func OpenBrowser(target string) {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", target)
	case "darwin":
		cmd = exec.Command("open", target)
	default:
		cmd = exec.Command("xdg-open", target)
	}
	_ = cmd.Start()
}
