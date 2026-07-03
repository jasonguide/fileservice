package main

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"path/filepath"
	"strings"
)

// FileItem represents a file or directory in the listing
type FileItem struct {
	Name         string `json:"name"`
	IsDir        bool   `json:"isDir"`
	Size         int64  `json:"size"`
	LastModified int64  `json:"lastModified"` // Unix timestamp in milliseconds
}

// APIResponse standard JSON response
type APIResponse struct {
	Success bool        `json:"success"`
	Message string      `json:"message,omitempty"`
	Data    interface{} `json:"data,omitempty"`
}

// safePath sanitizes a user-provided path and returns the absolute filesystem path.
// Prevents path traversal attacks by ensuring the resolved path stays within DataDir.
func safePath(userPath string) (string, error) {
	// Clean the path to remove any .. or . components
	cleaned := filepath.Clean("/" + userPath)
	// Join with data directory
	absPath := filepath.Join(config.DataDir, cleaned)
	// Verify the resulting path is still within DataDir
	relPath, err := filepath.Rel(config.DataDir, absPath)
	if err != nil {
		return "", err
	}
	if strings.HasPrefix(relPath, "..") {
		return "", &SecurityError{Msg: "path traversal detected"}
	}
	return absPath, nil
}

// SecurityError represents a path security violation
type SecurityError struct {
	Msg string
}

func (e *SecurityError) Error() string { return e.Msg }

// writeJSON writes a JSON response
func writeJSON(w http.ResponseWriter, code int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(data)
}

// writeError writes an error JSON response
func writeError(w http.ResponseWriter, code int, msg string) {
	writeJSON(w, code, APIResponse{Success: false, Message: msg})
}

// generateUploadID generates a random upload ID
func generateUploadID() string {
	b := make([]byte, 16)
	rand.Read(b)
	return hex.EncodeToString(b)
}

// formatBytes converts bytes to human readable string (used by frontend, but kept for reference)
func formatBytes(b int64) string {
	const unit = 1024
	if b < unit {
		return fmt.Sprintf("%d B", b)
	}
	div, exp := int64(unit), 0
	for n := b / unit; n >= unit; n /= unit {
		div *= unit
		exp++
	}
	suffix := []string{"KB", "MB", "GB", "TB", "PB"}
	return fmt.Sprintf("%.1f %s", float64(b)/float64(div), suffix[exp])
}
