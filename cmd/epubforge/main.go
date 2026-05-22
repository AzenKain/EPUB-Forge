package main

import (
	"context"
	"embed"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"epubforge/internal/router"
	"epubforge/internal/service"
	"epubforge/internal/utils"
)

//go:embed all:dist
var embeddedDist embed.FS

func main() {
	workspace, err := os.Getwd()
	if err != nil {
		log.Fatal(err)
	}
	svc, err := service.New(workspace)
	if err != nil {
		log.Fatal(err)
	}

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
