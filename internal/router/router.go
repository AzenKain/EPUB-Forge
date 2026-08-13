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
	mux.HandleFunc("/api/epubs/create", ctrl.CreateEpub)
	mux.HandleFunc("/api/epubs/merge", ctrl.MergeEpubs)
	mux.HandleFunc("/api/epubs/import-txt", ctrl.ImportTxt)
	mux.HandleFunc("/api/metadata/search", ctrl.SearchMetadata)
	mux.HandleFunc("/api/epubs/upload", ctrl.UploadEpub)
	mux.HandleFunc("/api/epubs/create-manga", ctrl.CreateManga)
	mux.HandleFunc("/api/extensions", ctrl.ListExtensions)
	mux.HandleFunc("/api/extensions/upload", ctrl.UploadExtension)
	mux.HandleFunc("/api/extensions/delete", ctrl.DeleteExtension)
	mux.HandleFunc("/api/extensions/run", ctrl.RunExtension)
	mux.HandleFunc("/api/extensions/interact", ctrl.InteractExtension)
	mux.HandleFunc("/api/extensions/store", ctrl.StoreExtensions)
	mux.HandleFunc("/api/extensions/install", ctrl.InstallExtension)
	mux.HandleFunc("/api/extensions/update", ctrl.UpdateExtension)
	mux.HandleFunc("/api/epubs/", ctrl.Epub)
	mux.HandleFunc("/api/files/", ctrl.File)
	mux.HandleFunc("/api/update/check", ctrl.CheckUpdate)
	mux.HandleFunc("/api/update/run", ctrl.RunUpdate)
	mux.HandleFunc("/api/update/progress", ctrl.GetUpdateProgress)
	mux.HandleFunc("/api/update/restart", ctrl.RestartApp)
	mux.HandleFunc("/", ctrl.Frontend)
	return mux
}
