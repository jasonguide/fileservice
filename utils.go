package main

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"unicode/utf8"
)

// FileItem represents a file or directory in the listing
type FileItem struct {
	Name         string `json:"name"`
	IsDir        bool   `json:"isDir"`
	Size         int64  `json:"size"`
	LastModified int64  `json:"lastModified"` // Unix timestamp in milliseconds
	// Preview is the preview kind ("image", "pdf", "text", ...) or "" when the
	// type is not previewable. Shipping it here keeps the frontend from having
	// to duplicate the whitelist in previewTypes.
	Preview string `json:"preview,omitempty"`
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

// ===== Preview support =====

// previewType describes how a file should be rendered by the browser.
type previewType struct {
	Kind string // grouping the frontend uses to pick a renderer
	Mime string // exact Content-Type served by /api/preview
}

// previewTypes is the whitelist of extensions /api/preview may serve inline.
// Anything absent is rejected with 415 and the frontend falls back to a plain
// download: preview is opt-in per type, never a content guess.
//
// Every entry is a format browsers render natively, which is what keeps this
// project free of third-party viewers.
var previewTypes = map[string]previewType{
	// Raster images
	"png":  {"image", "image/png"},
	"jpg":  {"image", "image/jpeg"},
	"jpeg": {"image", "image/jpeg"},
	"gif":  {"image", "image/gif"},
	"webp": {"image", "image/webp"},
	"bmp":  {"image", "image/bmp"},
	"ico":  {"image", "image/x-icon"},
	"avif": {"image", "image/avif"},
	"tif":  {"image", "image/tiff"},
	"tiff": {"image", "image/tiff"},

	// SVG and HTML are the only whitelisted types that would execute embedded
	// script if opened as a same-origin document; handlePreview pins them down
	// with a CSP header and the frontend renders them inside a sandbox.
	"svg":  {"svg", "image/svg+xml"},
	"html": {"html", "text/html; charset=utf-8"},
	"htm":  {"html", "text/html; charset=utf-8"},

	// Documents
	"pdf": {"pdf", "application/pdf"},

	// Video: native containers only. avi/mkv/wmv/flv are deliberately absent
	// because browsers cannot play them and a broken player is worse than a
	// clean download prompt.
	"mp4":  {"video", "video/mp4"},
	"m4v":  {"video", "video/mp4"},
	"webm": {"video", "video/webm"},
	"ogv":  {"video", "video/ogg"},
	"mov":  {"video", "video/quicktime"},

	// Audio
	"mp3":  {"audio", "audio/mpeg"},
	"wav":  {"audio", "audio/wav"},
	"ogg":  {"audio", "audio/ogg"},
	"oga":  {"audio", "audio/ogg"},
	"opus": {"audio", "audio/ogg"},
	"m4a":  {"audio", "audio/mp4"},
	"aac":  {"audio", "audio/aac"},
	"flac": {"audio", "audio/flac"},

	// Markdown: served as text, rendered by the frontend
	"md":       {"markdown", "text/markdown; charset=utf-8"},
	"markdown": {"markdown", "text/markdown; charset=utf-8"},

	// Plain text and source code
	"txt":        {"text", "text/plain; charset=utf-8"},
	"log":        {"text", "text/plain; charset=utf-8"},
	"csv":        {"text", "text/plain; charset=utf-8"},
	"tsv":        {"text", "text/plain; charset=utf-8"},
	"json":       {"text", "text/plain; charset=utf-8"},
	"xml":        {"text", "text/plain; charset=utf-8"},
	"yml":        {"text", "text/plain; charset=utf-8"},
	"yaml":       {"text", "text/plain; charset=utf-8"},
	"toml":       {"text", "text/plain; charset=utf-8"},
	"ini":        {"text", "text/plain; charset=utf-8"},
	"conf":       {"text", "text/plain; charset=utf-8"},
	"cfg":        {"text", "text/plain; charset=utf-8"},
	"env":        {"text", "text/plain; charset=utf-8"},
	"properties": {"text", "text/plain; charset=utf-8"},
	"sh":         {"text", "text/plain; charset=utf-8"},
	"bash":       {"text", "text/plain; charset=utf-8"},
	"zsh":        {"text", "text/plain; charset=utf-8"},
	"bat":        {"text", "text/plain; charset=utf-8"},
	"cmd":        {"text", "text/plain; charset=utf-8"},
	"ps1":        {"text", "text/plain; charset=utf-8"},
	"go":         {"text", "text/plain; charset=utf-8"},
	"py":         {"text", "text/plain; charset=utf-8"},
	"rb":         {"text", "text/plain; charset=utf-8"},
	"java":       {"text", "text/plain; charset=utf-8"},
	"kt":         {"text", "text/plain; charset=utf-8"},
	"c":          {"text", "text/plain; charset=utf-8"},
	"h":          {"text", "text/plain; charset=utf-8"},
	"cc":         {"text", "text/plain; charset=utf-8"},
	"cpp":        {"text", "text/plain; charset=utf-8"},
	"hpp":        {"text", "text/plain; charset=utf-8"},
	"cs":         {"text", "text/plain; charset=utf-8"},
	"rs":         {"text", "text/plain; charset=utf-8"},
	"js":         {"text", "text/plain; charset=utf-8"},
	"mjs":        {"text", "text/plain; charset=utf-8"},
	"cjs":        {"text", "text/plain; charset=utf-8"},
	"ts":         {"text", "text/plain; charset=utf-8"},
	"tsx":        {"text", "text/plain; charset=utf-8"},
	"jsx":        {"text", "text/plain; charset=utf-8"},
	"css":        {"text", "text/plain; charset=utf-8"},
	"scss":       {"text", "text/plain; charset=utf-8"},
	"less":       {"text", "text/plain; charset=utf-8"},
	"sql":        {"text", "text/plain; charset=utf-8"},
	"php":        {"text", "text/plain; charset=utf-8"},
	"swift":      {"text", "text/plain; charset=utf-8"},
	"lua":        {"text", "text/plain; charset=utf-8"},
	"pl":         {"text", "text/plain; charset=utf-8"},
	"dart":       {"text", "text/plain; charset=utf-8"},
	"vue":        {"text", "text/plain; charset=utf-8"},
	"svelte":     {"text", "text/plain; charset=utf-8"},
	"gradle":     {"text", "text/plain; charset=utf-8"},
	"dockerfile": {"text", "text/plain; charset=utf-8"},
	"lock":       {"text", "text/plain; charset=utf-8"},
	"patch":      {"text", "text/plain; charset=utf-8"},
	"diff":       {"text", "text/plain; charset=utf-8"},
}

// previewTypeOf classifies a filename by extension. Files without an extension
// are never previewable: guessing would mean serving unknown bytes inline.
func previewTypeOf(name string) (previewType, bool) {
	ext := strings.ToLower(strings.TrimPrefix(filepath.Ext(name), "."))
	if ext == "" {
		return previewType{}, false
	}
	pt, ok := previewTypes[ext]
	return pt, ok
}

// previewKind returns the preview kind for a filename, or "" when the type is
// not previewable.
func previewKind(name string) string {
	if pt, ok := previewTypeOf(name); ok {
		return pt.Kind
	}
	return ""
}

// contentDisposition builds an RFC 6266 Content-Disposition value.
//
// The bare filename= parameter is restricted to ASCII because HTTP headers are
// latin-1: writing UTF-8 bytes there is what turned "中文 报告.txt" into
// "ä¸­æ æ¥å.txt" in every browser. The real name travels in filename*,
// percent-encoded per RFC 5987, which all current browsers prefer.
func contentDisposition(disposition, filename string) string {
	ascii := make([]byte, 0, len(filename))
	for i := 0; i < len(filename); i++ {
		c := filename[i]
		if c > 0x20 && c < 0x7f && c != '"' && c != '\\' {
			ascii = append(ascii, c)
		} else {
			ascii = append(ascii, '_')
		}
	}
	return disposition + `; filename="` + string(ascii) + `"; filename*=UTF-8''` + rfc5987Escape(filename)
}

// Memory budget for text responses.
//
// The previous implementation used os.ReadFile, so opening a 150 MB log spiked
// the process to roughly 600 MB: the raw bytes, the string conversion and the
// JSON encoding each hold a copy, about 4x amplification. With a 200 MB
// container limit, a 40 MB file was already enough to get the process killed.
//
// Reading is therefore always bounded, on both paths:
//   - preview reads at most textPreviewLimit and reports the truncation
//   - editing reads at most textEditLimit and refuses anything larger
// Neither path can read an unbounded amount, whatever the file size on disk.
const textPreviewLimit = 1 << 20  // 1 MiB shown in the preview
const textEditLimit = 32 << 20    // 32 MiB loadable into the editor

// readFileHead reads at most limit bytes from path. The result is trimmed back
// to a rune boundary so a byte-count limit cannot split a multi-byte UTF-8
// character in half.
//
// The buffer is sized to what will actually be read rather than to limit:
// allocating the full limit regardless of file size cost 32 MB on every editor
// request, even for a 2 MB file.
func readFileHead(path string, size, limit int64) ([]byte, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	n := size
	if n > limit {
		n = limit
	}
	buf := make([]byte, n)
	read, err := io.ReadFull(f, buf)
	if err != nil && err != io.EOF && err != io.ErrUnexpectedEOF {
		return nil, err
	}
	buf = buf[:read]

	// At most one partial rune can straddle the end of the buffer, so a few
	// bytes of trimming is always enough to land on a boundary.
	if !utf8.Valid(buf) {
		for trim := 1; trim <= utf8.UTFMax-1 && trim <= len(buf); trim++ {
			if utf8.Valid(buf[:len(buf)-trim]) {
				buf = buf[:len(buf)-trim]
				break
			}
		}
	}

	return buf, nil
}

// rfc5987Escape percent-encodes a string as an RFC 5987 ext-value. url.PathEscape
// is not usable here because it leaves ":" ";" "=" "," "@" unescaped, none of
// which RFC 5987 allows in attr-char.
func rfc5987Escape(s string) string {
	var b strings.Builder
	for i := 0; i < len(s); i++ {
		c := s[i]
		if (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') ||
			strings.IndexByte("!#$&+-.^_`|~", c) >= 0 {
			b.WriteByte(c)
		} else {
			fmt.Fprintf(&b, "%%%02X", c)
		}
	}
	return b.String()
}
