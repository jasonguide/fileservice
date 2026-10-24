package main

import (
	"archive/zip"
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
			Preview:      previewKind(entry.Name()),
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
	w.Header().Set("Content-Disposition", contentDisposition("attachment", filepath.Base(absPath)))
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
		// ?full=1 asks for the whole file, which only the editor needs so that a
		// save cannot silently drop the tail. Even then the read is bounded:
		// past textEditLimit the request is refused rather than loaded, so no
		// code path can pull an arbitrarily large file into memory.
		full := r.URL.Query().Get("full") == "1"
		size := info.Size()

		// Reject on the stat result, before allocating anything. Reading up to
		// the limit and only then checking costs a full textEditLimit buffer
		// (32 MB) on every rejected request, which is exactly the allocation
		// this endpoint exists to avoid.
		if full && size > textEditLimit {
			writeError(w, http.StatusRequestEntityTooLarge, "file is too large to edit (limit 32 MB), please download it")
			return
		}

		limit := int64(textPreviewLimit)
		if full {
			limit = textEditLimit
		}

		head, err := readFileHead(absPath, size, limit)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to read file")
			return
		}

		truncated := int64(len(head)) < size
		payload := map[string]interface{}{
			"name":      filepath.Base(absPath),
			"content":   string(head),
			"type":      contentType,
			"size":      size,
			"truncated": truncated,
		}
		if truncated {
			// Tell the caller what it is looking at so the UI can explain the
			// difference between "this is the file" and "this is the start of it".
			payload["previewLimit"] = limit
		}
		writeJSON(w, http.StatusOK, APIResponse{Success: true, Data: payload})
		return
	}

	// For binary/image files, serve directly for preview
	http.ServeFile(w, r, absPath)
}

// handlePreview serves a file inline so the browser can render it in place.
//
// Only extensions in previewTypes are served; everything else is refused with
// 415 so an unknown type is never handed to the browser inline. The response
// body itself comes from http.ServeFile, which supplies Range support (video
// and audio scrubbing) and conditional requests for free.
func handlePreview(w http.ResponseWriter, r *http.Request) {
	if r.Method != "GET" && r.Method != "HEAD" {
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

	pt, ok := previewTypeOf(absPath)
	if !ok {
		writeError(w, http.StatusUnsupportedMediaType, "file type is not previewable")
		return
	}

	// ServeFile consults the extension to pick its own Content-Type when the
	// header is unset, so it must be set here, before the call.
	w.Header().Set("Content-Type", pt.Mime)
	w.Header().Set("Content-Disposition", contentDisposition("inline", filepath.Base(absPath)))
	// Never let a sniffed type override the whitelist decision above.
	w.Header().Set("X-Content-Type-Options", "nosniff")

	// SVG and HTML are executable when rendered as a same-origin document: a
	// crafted file could call the API with the viewer's session. Before serving
	// them inline, strip that ability with a sandboxing CSP. The blank
	// sandbox value means "allow nothing"; everything the renderer needs is
	// inlined in the file itself, so no directive has to be re-enabled.
	//
	// The PDF viewer additionally runs its own JS, so PDFs are sandboxed too.
	if pt.Kind == "svg" || pt.Kind == "html" || pt.Kind == "pdf" {
		w.Header().Set("Content-Security-Policy", "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'")
		w.Header().Set("Cross-Origin-Resource-Policy", "same-origin")
	}

	http.ServeFile(w, r, absPath)
}

// handleDownloadBatch streams the requested paths into a single zip archive.
//
// Downloading several files one by one cannot work in a browser: folders are
// refused by /api/download and browsers silently drop all but the first of a
// burst of programmatic downloads. Zipping server-side is the only way a
// selection can arrive as one artifact.
//
// The archive is written straight to the response, so memory stays flat
// regardless of how much is selected -- the same constraint the rest of this
// service follows.
func handleDownloadBatch(w http.ResponseWriter, r *http.Request) {
	if r.Method != "GET" && r.Method != "POST" {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	// Accept both repeated ?path= params and a JSON body {paths: [...]}, so the
	// caller is not forced into one shape when a path contains characters that
	// are awkward to repeat in a query string.
	var paths []string
	paths = append(paths, r.URL.Query()["path"]...)
	if len(paths) == 0 {
		var req struct {
			Paths []string `json:"paths"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err == nil {
			paths = append(paths, req.Paths...)
		}
	}

	// Drop empties and de-duplicate: a repeated selection must not appear twice
	// in the archive, which would also make zip entry names collide.
	seen := make(map[string]bool, len(paths))
	unique := make([]string, 0, len(paths))
	for _, p := range paths {
		if p == "" || seen[p] {
			continue
		}
		seen[p] = true
		unique = append(unique, p)
	}
	if len(unique) == 0 {
		writeError(w, http.StatusBadRequest, "path is required")
		return
	}

	// Resolve and validate everything before writing any output, so a bad path
	// fails the request instead of producing a truncated archive.
	type item struct {
		abs  string
		name string
		isDir bool
	}
	items := make([]item, 0, len(unique))
	for _, p := range unique {
		abs, err := safePath(p)
		if err != nil {
			writeError(w, http.StatusBadRequest, "invalid path")
			return
		}
		info, err := os.Stat(abs)
		if err != nil {
			if os.IsNotExist(err) {
				writeError(w, http.StatusNotFound, "not found: "+filepath.Base(abs))
				return
			}
			writeError(w, http.StatusInternalServerError, "failed to stat file")
			return
		}
		// Never let the data root itself be zipped: that would package the whole
		// store into one response.
		if abs == config.DataDir {
			writeError(w, http.StatusBadRequest, "cannot download root directory")
			return
		}
		items = append(items, item{abs: abs, name: filepath.Base(abs), isDir: info.IsDir()})
	}

	archiveName := "files.zip"
	if len(items) == 1 {
		archiveName = items[0].name
		if !items[0].isDir {
			archiveName = strings.TrimSuffix(archiveName, filepath.Ext(archiveName))
		}
		archiveName += ".zip"
	}

	// Headers must be set before the first byte of the body is written.
	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", contentDisposition("attachment", archiveName))

	zw := zip.NewWriter(w)
	defer zw.Close()

	for _, it := range items {
		if it.isDir {
			// A directory is stored under a single top-level folder so that
			// selecting several folders cannot interleave their contents.
			writeZipDir(zw, it.abs, it.name)
			continue
		}
		if err := writeZipFile(zw, it.abs, it.name); err != nil {
			// The response is already streaming, so the failure can only be
			// recorded in the archive itself, not reported as an HTTP error.
			log.Printf("batch download: failed to add %s: %v", it.abs, err)
			return
		}
	}
}

// writeZipFile streams one file into the archive under the given entry name.
func writeZipFile(zw *zip.Writer, absPath, entryName string) error {
	f, err := os.Open(absPath)
	if err != nil {
		return err
	}
	defer f.Close()

	info, err := f.Stat()
	if err != nil {
		return err
	}

	hdr, err := zip.FileInfoHeader(info)
	if err != nil {
		return err
	}
	hdr.Name = filepath.ToSlash(entryName)
	hdr.Method = zip.Deflate

	entry, err := zw.CreateHeader(hdr)
	if err != nil {
		return err
	}
	// io.Copy keeps this bounded: the file is read in small chunks, never
		// loaded whole.
	_, err = io.Copy(entry, f)
	return err
}

// writeZipDir walks a directory and adds every file under prefix/.
func writeZipDir(zw *zip.Writer, absDir, prefix string) {
	// WalkDir does not follow symlinks, which keeps a link cycle from turning
	// into an infinite archive.
	filepath.WalkDir(absDir, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			log.Printf("batch download: skipping %s: %v", path, err)
			return nil // keep going; one unreadable entry should not abort the rest
		}
		if d.IsDir() {
			return nil
		}

		rel, err := filepath.Rel(absDir, path)
		if err != nil {
			return nil
		}
		entryName := filepath.ToSlash(filepath.Join(prefix, rel))
		if err := writeZipFile(zw, path, entryName); err != nil {
			log.Printf("batch download: failed to add %s: %v", path, err)
			return nil
		}
		return nil
	})
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
