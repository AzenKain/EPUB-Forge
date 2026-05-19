package router

import (
	"io/fs"
	"net/http"

	"epubforge/internal/controller"
	"epubforge/internal/service"
)

func New(svc *service.Service, frontend fs.FS) *http.ServeMux {
	ctrl := controller.New(svc, frontend)
	mux := http.NewServeMux()
	mux.HandleFunc("/api/epubs", ctrl.ListEpubs)
	mux.HandleFunc("/api/epubs/merge", ctrl.MergeEpubs)
	mux.HandleFunc("/api/epubs/import-txt", ctrl.ImportTxt)
	mux.HandleFunc("/api/epubs/", ctrl.Epub)
	mux.HandleFunc("/api/files/", ctrl.File)
	mux.HandleFunc("/", ctrl.Frontend)
	return mux
}
