package main

import (
	"encoding/json"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
)

// handleList returns the contents of a directory
func handleList(w http.ResponseWriter, r *http.Request) {
	if r.Method != "GET" {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	userPath := r.URL.Query().Get("path")
	if userPath == "" {
		userPath = "/"
	}

	absPath, err := safePath(userPath)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid path")
		return
	}

	entries, err := os.ReadDir(absPath)
	if err != nil {
		if os.IsNotExist(err) {
			writeError(w, http.StatusNotFound, "directory not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to read directory")
		return
	}

	var items []FileItem
	for _, entry := range entries {
		// Skip hidden files
		if strings.HasPrefix(entry.Name(), ".") {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			continue
		}
		items = append(items, FileItem{
			Name:         entry.Name(),
			IsDir:        entry.IsDir(),
			Size:         info.Size(),
			LastModified: info.ModTime().UnixMilli(),
		})
	}

	// Default sort: directories first, then by name
	sort.Slice(items, func(i, j int) bool {
		if items[i].IsDir != items[j].IsDir {
			return items[i].IsDir
		}
		return items[i].Name < items[j].Name
	})

	writeJSON(w, http.StatusOK, APIResponse{
		Success: true,
		Data: map[string]interface{}{
			"path":  userPath,
			"items": items,
		},
	})
}

// handleUpload handles regular (non-chunked) file uploads via multipart form
func handleUpload(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	// Limit: 32MB in memory, rest to disk
	r.ParseMultipartForm(32 << 20)

	userPath := r.URL.Query().Get("path")
	if userPath == "" {
		userPath = "/"
	}

	absPath, err := safePath(userPath)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid path")
		return
	}

	file, header, err := r.FormFile("file")
	if err != nil {
		writeError(w, http.StatusBadRequest, "no file provided")
		return
	}
	defer file.Close()

	// Sanitize filename
	filename := sanitizeFilename(header.Filename)
	if filename == "" {
		writeError(w, http.StatusBadRequest, "invalid filename")
		return
	}

	destPath := filepath.Join(absPath, filename)
	dst, err := os.Create(destPath)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create file")
		return
	}
	defer dst.Close()

	if _, err := io.Copy(dst, file); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to write file")
		return
	}

	writeJSON(w, http.StatusOK, APIResponse{
		Success: true,
		Message: "upload successful",
		Data: map[string]interface{}{
			"name": filename,
			"size": header.Size,
		},
	})
}

// UploadInitRequest for chunked upload initialization
type UploadInitRequest struct {
	Filename    string `json:"filename"`
	FileSize    int64  `json:"fileSize"`
	TotalChunks int    `json:"totalChunks"`
	ChunkSize   int64  `json:"chunkSize"`
	Path        string `json:"path"`
}

// handleUploadInit initializes a chunked upload session
func handleUploadInit(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	var req UploadInitRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if req.Filename == "" || req.TotalChunks <= 0 {
		writeError(w, http.StatusBadRequest, "filename and totalChunks are required")
		return
	}

	uploadID := generateUploadID()
	tempDir := filepath.Join(os.TempDir(), "fileservice_uploads", uploadID)
	if err := os.MkdirAll(tempDir, 0755); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create temp directory")
		return
	}

	// Store upload metadata
	meta := map[string]interface{}{
		"filename":    sanitizeFilename(req.Filename),
		"fileSize":    req.FileSize,
		"totalChunks": req.TotalChunks,
		"chunkSize":   req.ChunkSize,
		"path":        req.Path,
		"received":    0,
	}
	metaData, _ := json.Marshal(meta)
	os.WriteFile(filepath.Join(tempDir, "meta.json"), metaData, 0644)

	writeJSON(w, http.StatusOK, APIResponse{
		Success: true,
		Data: map[string]interface{}{
			"uploadId": uploadID,
		},
	})
}

// handleUploadChunk receives a single chunk of a chunked upload
func handleUploadChunk(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	uploadID := r.URL.Query().Get("uploadId")
	chunkIndex := r.URL.Query().Get("chunkIndex")

	if uploadID == "" || chunkIndex == "" {
		writeError(w, http.StatusBadRequest, "uploadId and chunkIndex are required")
		return
	}

	tempDir := filepath.Join(os.TempDir(), "fileservice_uploads", uploadID)
	if _, err := os.Stat(tempDir); os.IsNotExist(err) {
		writeError(w, http.StatusNotFound, "upload session not found")
		return
	}

	// Read chunk data from request body
	chunkPath := filepath.Join(tempDir, "chunk_"+chunkIndex)
	dst, err := os.Create(chunkPath)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create chunk file")
		return
	}
	defer dst.Close()

	// Limit chunk size to 100MB to prevent abuse
	limitedReader := io.LimitReader(r.Body, 100<<20)
	written, err := io.Copy(dst, limitedReader)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to write chunk")
		return
	}

	writeJSON(w, http.StatusOK, APIResponse{
		Success: true,
		Data: map[string]interface{}{
			"chunkIndex": chunkIndex,
			"size":       written,
		},
	})
}

// UploadCompleteRequest for completing a chunked upload
type UploadCompleteRequest struct {
	UploadID string `json:"uploadId"`
}

// handleUploadComplete merges all chunks into the final file
func handleUploadComplete(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	var req UploadCompleteRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if req.UploadID == "" {
		writeError(w, http.StatusBadRequest, "uploadId is required")
		return
	}

	tempDir := filepath.Join(os.TempDir(), "fileservice_uploads", req.UploadID)
	if _, err := os.Stat(tempDir); os.IsNotExist(err) {
		writeError(w, http.StatusNotFound, "upload session not found")
		return
	}

	// Read metadata
	metaData, err := os.ReadFile(filepath.Join(tempDir, "meta.json"))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to read upload metadata")
		return
	}

	var meta map[string]interface{}
	json.Unmarshal(metaData, &meta)

	filename, _ := meta["filename"].(string)
	totalChunks := int(meta["totalChunks"].(float64))
	uploadPath, _ := meta["path"].(string)
	if uploadPath == "" {
		uploadPath = "/"
	}

	// Get destination directory
	absPath, err := safePath(uploadPath)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid path")
		return
	}

	// Ensure directory exists
	os.MkdirAll(absPath, 0755)

	// Create the final file
	destPath := filepath.Join(absPath, filename)
	finalFile, err := os.Create(destPath)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create destination file")
		return
	}
	defer finalFile.Close()

	// Merge chunks in order
	for i := 0; i < totalChunks; i++ {
		chunkPath := filepath.Join(tempDir, "chunk_"+strconv.Itoa(i))
		chunkFile, err := os.Open(chunkPath)
		if err != nil {
			// Missing chunk
			finalFile.Close()
			os.Remove(destPath)
			writeError(w, http.StatusBadRequest, "missing chunk: "+strconv.Itoa(i))
			return
		}
		io.Copy(finalFile, chunkFile)
		chunkFile.Close()
	}

	// Clean up temp directory
	os.RemoveAll(tempDir)

	// Get final file info
	info, _ := os.Stat(destPath)

	writeJSON(w, http.StatusOK, APIResponse{
		Success: true,
		Message: "upload complete",
		Data: map[string]interface{}{
			"name": filename,
			"size": info.Size(),
		},
	})
}

// handleUploadCancel cancels a chunked upload and cleans up
func handleUploadCancel(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	var req struct {
		UploadID string `json:"uploadId"`
	}
	json.NewDecoder(r.Body).Decode(&req)

	if req.UploadID == "" {
		writeError(w, http.StatusBadRequest, "uploadId is required")
		return
	}

	tempDir := filepath.Join(os.TempDir(), "fileservice_uploads", req.UploadID)
	os.RemoveAll(tempDir)

	writeJSON(w, http.StatusOK, APIResponse{
		Success: true,
		Message: "upload cancelled",
	})
}

// handleDownload serves a file for download (supports range requests for resume)
func handleDownload(w http.ResponseWriter, r *http.Request) {
	if r.Method != "GET" {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	userPath := r.URL.Query().Get("path")
	if userPath == "" {
		writeError(w, http.StatusBadRequest, "path is required")
		return
	}

	absPath, err := safePath(userPath)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid path")
		return
	}

	info, err := os.Stat(absPath)
	if err != nil {
		if os.IsNotExist(err) {
			writeError(w, http.StatusNotFound, "file not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to stat file")
		return
	}

	if info.IsDir() {
		writeError(w, http.StatusBadRequest, "cannot download a directory")
		return
	}

	// Set Content-Disposition for download
	w.Header().Set("Content-Disposition", "attachment; filename=\""+filepath.Base(absPath)+"\"")
	http.ServeFile(w, r, absPath)
}

// handleDelete deletes a file or directory
func handleDelete(w http.ResponseWriter, r *http.Request) {
	if r.Method != "DELETE" && r.Method != "POST" {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	userPath := r.URL.Query().Get("path")
	if userPath == "" {
		// Try JSON body
		var req struct {
			Path string `json:"path"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err == nil && req.Path != "" {
			userPath = req.Path
		}
	}

	if userPath == "" {
		writeError(w, http.StatusBadRequest, "path is required")
		return
	}

	absPath, err := safePath(userPath)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid path")
		return
	}

	// Prevent deleting the root data directory
	if absPath == config.DataDir {
		writeError(w, http.StatusBadRequest, "cannot delete root directory")
		return
	}

	if err := os.RemoveAll(absPath); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to delete")
		return
	}

	writeJSON(w, http.StatusOK, APIResponse{
		Success: true,
		Message: "deleted successfully",
	})
}

// handleMkdir creates a new directory
func handleMkdir(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	var req struct {
		Path string `json:"path"`
		Name string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if req.Name == "" {
		writeError(w, http.StatusBadRequest, "name is required")
		return
	}

	userPath := req.Path
	if userPath == "" {
		userPath = "/"
	}

	absPath, err := safePath(userPath)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid path")
		return
	}

	dirPath := filepath.Join(absPath, sanitizeFilename(req.Name))
	if err := os.MkdirAll(dirPath, 0755); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create directory")
		return
	}

	writeJSON(w, http.StatusOK, APIResponse{
		Success: true,
		Message: "directory created",
	})
}

// handleCreateFile creates a new text file with content
func handleCreateFile(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	var req struct {
		Path    string `json:"path"`
		Name    string `json:"name"`
		Content string `json:"content"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if req.Name == "" {
		writeError(w, http.StatusBadRequest, "name is required")
		return
	}

	userPath := req.Path
	if userPath == "" {
		userPath = "/"
	}

	absPath, err := safePath(userPath)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid path")
		return
	}

	filePath := filepath.Join(absPath, sanitizeFilename(req.Name))
	if err := os.WriteFile(filePath, []byte(req.Content), 0644); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create file")
		return
	}

	writeJSON(w, http.StatusOK, APIResponse{
		Success: true,
		Message: "file created",
	})
}

// handleFile returns file content (for text preview/edit) or serves file for preview
func handleFile(w http.ResponseWriter, r *http.Request) {
	if r.Method != "GET" {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	userPath := r.URL.Query().Get("path")
	if userPath == "" {
		writeError(w, http.StatusBadRequest, "path is required")
		return
	}

	absPath, err := safePath(userPath)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid path")
		return
	}

	info, err := os.Stat(absPath)
	if err != nil {
		if os.IsNotExist(err) {
			writeError(w, http.StatusNotFound, "file not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to stat file")
		return
	}

	if info.IsDir() {
		writeError(w, http.StatusBadRequest, "path is a directory")
		return
	}

	// For text files, return content as JSON
	// For binary files, serve directly
	contentType := detectContentType(absPath)
	if strings.HasPrefix(contentType, "text/") || contentType == "application/json" || contentType == "application/javascript" {
		content, err := os.ReadFile(absPath)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to read file")
			return
		}
		writeJSON(w, http.StatusOK, APIResponse{
			Success: true,
			Data: map[string]interface{}{
				"name":    filepath.Base(absPath),
				"content": string(content),
				"type":    contentType,
			},
		})
		return
	}

	// For binary/image files, serve directly for preview
	http.ServeFile(w, r, absPath)
}

// handleRename renames a file or directory
func handleRename(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	var req struct {
		Path    string `json:"path"`
		NewName string `json:"newName"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if req.Path == "" || req.NewName == "" {
		writeError(w, http.StatusBadRequest, "path and newName are required")
		return
	}

	absPath, err := safePath(req.Path)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid path")
		return
	}

	newPath := filepath.Join(filepath.Dir(absPath), sanitizeFilename(req.NewName))
	if err := os.Rename(absPath, newPath); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to rename")
		return
	}

	writeJSON(w, http.StatusOK, APIResponse{
		Success: true,
		Message: "renamed successfully",
	})
}

// sanitizeFilename removes dangerous characters from a filename
func sanitizeFilename(name string) string {
	// Take only the base name (strip any path components)
	name = filepath.Base(name)
	// Remove null bytes and other dangerous characters
	name = strings.ReplaceAll(name, "\x00", "")
	// Don't allow empty or dot-only names
	if name == "" || name == "." || name == ".." {
		return ""
	}
	return name
}

// detectContentType reads the first 512 bytes to determine content type
func detectContentType(path string) string {
	file, err := os.Open(path)
	if err != nil {
		return "application/octet-stream"
	}
	defer file.Close()

	buf := make([]byte, 512)
	n, _ := file.Read(buf)
	return http.DetectContentType(buf[:n])
}

// init logs the upload directory on startup
func init() {
	tempDir := filepath.Join(os.TempDir(), "fileservice_uploads")
	os.MkdirAll(tempDir, 0755)
	log.Printf("Temp upload directory: %s", tempDir)
}
