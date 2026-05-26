package main

import (
	"context"
	"embed"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"epubforge/internal/router"
	"epubforge/internal/service"
	"epubforge/internal/utils"
)

//go:embed all:dist
var embeddedDist embed.FS

var Version = "1.8.0"

func main() {
	workspace, err := os.Getwd()
	if err != nil {
		log.Fatal(err)
	}
	svc, err := service.New(workspace, Version)
	if err != nil {
		log.Fatal(err)
	}
	defer svc.Close()

	// Clean up any left-over .old files from a previous self-update
	go func() {
		time.Sleep(2 * time.Second)
		self, err := os.Executable()
		if err == nil {
			oldFile := filepath.Join(filepath.Dir(self), "."+filepath.Base(self)+".old")
			if _, err := os.Stat(oldFile); err == nil {
				_ = os.Remove(oldFile)
			}
		}
	}()

	go func() {
		time.Sleep(1 * time.Second)
		log.Printf("[SelfUpdate] Đang kiểm tra bản cập nhật (phiên bản hiện tại: %s)...", Version)
		res, err := svc.CheckUpdate(context.Background())
		if err != nil {
			log.Printf("[SelfUpdate] Lỗi khi kiểm tra cập nhật: %v", err)
			return
		}
		if res.UpdateAvailable {
			log.Printf("[SelfUpdate] Đã tìm thấy bản cập nhật mới: %s!", res.LatestVersion)
		} else {
			log.Printf("[SelfUpdate] EPUBForge đã ở phiên bản mới nhất (%s).", Version)
		}
	}()

	port := utils.Env("PORT", "5180")
	addr := "127.0.0.1:" + port
	log.Printf("EPUBForge listening on http://%s", addr)
	if os.Getenv("NO_OPEN") == "" {
		go func() {
			time.Sleep(400 * time.Millisecond)
			utils.OpenBrowser("http://" + addr)
		}()
	}

	server := &http.Server{
		Addr:    addr,
		Handler: router.New(svc, embeddedDist),
	}

	// Graceful shutdown on Ctrl+C / SIGTERM
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, os.Interrupt, syscall.SIGTERM)

	go func() {
		<-quit
		log.Println("Shutting down...")
		svc.Close()
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		_ = server.Shutdown(ctx)
	}()

	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatal(err)
	}
}
