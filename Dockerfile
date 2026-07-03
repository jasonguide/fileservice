# Build stage
FROM golang:1.21-alpine AS builder

WORKDIR /build

# Copy source files
COPY go.mod ./
COPY main.go utils.go handlers.go ./
COPY static/ ./static/

# Build static binary
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o fileservice .

# Runtime stage
FROM alpine:3.19

# Install ca-certificates for HTTPS
RUN apk --no-cache add ca-certificates

# Create non-root user
RUN addgroup -S app && adduser -S app -G app

WORKDIR /app

# Copy binary from builder
COPY --from=builder /build/fileservice /app/fileservice

# Create data directory
RUN mkdir -p /data && chown -R app:app /data

# Switch to non-root user
USER app

EXPOSE 8010

ENV PORT=8010
ENV DATA_DIR=/data

ENTRYPOINT ["/app/fileservice"]
