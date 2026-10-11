package main

import (
	"embed"
	"io/fs"
	"log"
	"net/http"
	"os"
	"path/filepath"
)

//go:embed static
var staticFiles embed.FS

// Config holds the application configuration
type Config struct {
	Port    string
	DataDir string
}

var config Config

func main() {
	// Load configuration from environment
	config.Port = getEnv("PORT", "8080")
	config.DataDir = getEnv("DATA_DIR", "/data")

	// Ensure data directory exists
	if err := os.MkdirAll(config.DataDir, 0755); err != nil {
		log.Fatalf("Failed to create data directory: %v", err)
	}

	// Ensure temp upload directory exists
	tempDir := filepath.Join(os.TempDir(), "fileservice_uploads")
	if err := os.MkdirAll(tempDir, 0755); err != nil {
		log.Fatalf("Failed to create temp directory: %v", err)
	}

	// Register API routes
	mux := http.NewServeMux()

	// API endpoints
	mux.HandleFunc("/api/list", handleList)
	mux.HandleFunc("/api/upload", handleUpload)
	mux.HandleFunc("/api/upload/init", handleUploadInit)
	mux.HandleFunc("/api/upload/chunk", handleUploadChunk)
	mux.HandleFunc("/api/upload/complete", handleUploadComplete)
	mux.HandleFunc("/api/upload/cancel", handleUploadCancel)
	mux.HandleFunc("/api/download", handleDownload)
	mux.HandleFunc("/api/delete", handleDelete)
	mux.HandleFunc("/api/mkdir", handleMkdir)
	mux.HandleFunc("/api/create-file", handleCreateFile)
	mux.HandleFunc("/api/file", handleFile)
	mux.HandleFunc("/api/preview", handlePreview)
	mux.HandleFunc("/api/rename", handleRename)

	// Serve embedded static files
	staticFS, _ := fs.Sub(staticFiles, "static")
	fileServer := http.FileServer(http.FS(staticFS))
	mux.Handle("/", fileServer)

	// Apply middleware
	handler := withCORS(withLogging(mux))

	log.Printf("FileService starting on :%s, data dir: %s", config.Port, config.DataDir)
	if err := http.ListenAndServe(":"+config.Port, handler); err != nil {
		log.Fatalf("Server failed: %v", err)
	}
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

// Middleware: CORS
func withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, X-Upload-Id, X-Chunk-Index")
		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusOK)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// Middleware: request logging
func withLogging(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		next.ServeHTTP(w, r)
	})
}
