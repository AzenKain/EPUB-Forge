package main

import (
	"embed"
	"log"
	"net/http"
	"os"
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

	if err := http.ListenAndServe(addr, router.New(svc, embeddedDist)); err != nil {
		log.Fatal(err)
	}
}
