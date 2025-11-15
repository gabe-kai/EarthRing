package api

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/earthring/server/internal/config"
)

func TestWebSocketHandlers_NewWebSocketHandlers(t *testing.T) {
	cfg := &config.Config{
		Auth: config.AuthConfig{
			JWTSecret:     "test-secret-key-for-testing-only",
			RefreshSecret: "test-refresh-secret-key-for-testing-only",
		},
	}
	
	handlers := NewWebSocketHandlers(nil, cfg)
	if handlers == nil {
		t.Fatal("NewWebSocketHandlers returned nil")
	}
	
	if handlers.hub == nil {
		t.Error("WebSocket hub is nil")
	}
	
	if handlers.jwtService == nil {
		t.Error("JWT service is nil")
	}
}

func TestWebSocketHandlers_negotiateVersion(t *testing.T) {
	cfg := &config.Config{
		Auth: config.AuthConfig{
			JWTSecret:     "test-secret-key-for-testing-only",
			RefreshSecret: "test-refresh-secret-key-for-testing-only",
		},
	}
	
	handlers := NewWebSocketHandlers(nil, cfg)
	
	tests := []struct {
		name     string
		requested string
		expected string
	}{
		{"empty string defaults to v1", "", ProtocolVersion1},
		{"v1 requested", ProtocolVersion1, ProtocolVersion1},
		{"multiple versions", "earthring-v2, earthring-v1", ProtocolVersion1},
		{"unsupported version", "earthring-v99", ""},
	}
	
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := handlers.negotiateVersion(tt.requested)
			if result != tt.expected {
				t.Errorf("negotiateVersion(%q) = %q, want %q", tt.requested, result, tt.expected)
			}
		})
	}
}

func TestWebSocketHub_Run(t *testing.T) {
	hub := NewWebSocketHub()
	
	// Start hub in goroutine
	go hub.Run()
	
	// Give it a moment to start
	time.Sleep(10 * time.Millisecond)
	
	// Test that hub is running (can't easily test without a real connection)
	// This is a basic smoke test
	if hub.connections == nil {
		t.Error("Hub connections map is nil")
	}
}

func TestWebSocketHandlers_extractToken(t *testing.T) {
	cfg := &config.Config{
		Auth: config.AuthConfig{
			JWTSecret:     "test-secret-key-for-testing-only",
			RefreshSecret: "test-refresh-secret-key-for-testing-only",
		},
	}
	
	handlers := NewWebSocketHandlers(nil, cfg)
	
	tests := []struct {
		name    string
		request *http.Request
		wantErr bool
	}{
		{
			name: "token in query parameter",
			request: func() *http.Request {
				req := httptest.NewRequest("GET", "/ws?token=test-token", nil)
				return req
			}(),
			wantErr: false,
		},
		{
			name: "token in Authorization header",
			request: func() *http.Request {
				req := httptest.NewRequest("GET", "/ws", nil)
				req.Header.Set("Authorization", "Bearer test-token")
				return req
			}(),
			wantErr: false,
		},
		{
			name:    "no token",
			request: httptest.NewRequest("GET", "/ws", nil),
			wantErr: true,
		},
	}
	
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			token, err := handlers.extractToken(tt.request)
			if (err != nil) != tt.wantErr {
				t.Errorf("extractToken() error = %v, wantErr %v", err, tt.wantErr)
				return
			}
			if !tt.wantErr && token == "" {
				t.Error("extractToken() returned empty token when error not expected")
			}
		})
	}
}

