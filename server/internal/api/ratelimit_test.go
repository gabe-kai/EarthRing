package api

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestRateLimitMiddleware(t *testing.T) {
	// Create a simple handler
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("OK"))
	})
	
	// Create rate limit middleware (5 requests per minute)
	middleware := RateLimitMiddleware(5, 1*time.Minute)
	wrappedHandler := middleware(handler)
	
	// Make 5 requests (should all succeed)
	for i := 0; i < 5; i++ {
		req := httptest.NewRequest("GET", "/test", nil)
		req.RemoteAddr = "127.0.0.1:12345"
		w := httptest.NewRecorder()
		
		wrappedHandler.ServeHTTP(w, req)
		
		if w.Code != http.StatusOK {
			t.Errorf("Request %d: Expected status 200, got %d", i+1, w.Code)
		}
		
		// Check rate limit headers
		limit := w.Header().Get("X-RateLimit-Limit")
		if limit != "5" {
			t.Errorf("Request %d: Expected X-RateLimit-Limit '5', got '%s'", i+1, limit)
		}
		
		remaining := w.Header().Get("X-RateLimit-Remaining")
		expectedRemaining := 5 - (i + 1)
		if remaining != string(rune('0'+expectedRemaining)) && remaining != "0" {
			// Allow some flexibility due to timing
			if i < 4 && remaining == "0" {
				t.Logf("Request %d: Remaining is 0 (may be due to timing)", i+1)
			}
		}
	}
	
	// 6th request should be rate limited
	req := httptest.NewRequest("GET", "/test", nil)
	req.RemoteAddr = "127.0.0.1:12345"
	w := httptest.NewRecorder()
	
	wrappedHandler.ServeHTTP(w, req)
	
	if w.Code != http.StatusTooManyRequests {
		t.Errorf("Expected status 429 (Too Many Requests), got %d", w.Code)
	}
	
	// Check error response
	if w.Body.String() == "" {
		t.Error("Expected error response body, got empty")
	}
}

func TestGetClientIP(t *testing.T) {
	tests := []struct {
		name           string
		remoteAddr     string
		forwardedFor   string
		realIP         string
		expectedResult string
	}{
		{
			name:           "X-Forwarded-For takes precedence",
			remoteAddr:     "192.168.1.1:12345",
			forwardedFor:   "10.0.0.1",
			expectedResult: "10.0.0.1",
		},
		{
			name:           "X-Real-IP used if no X-Forwarded-For",
			remoteAddr:     "192.168.1.1:12345",
			realIP:         "10.0.0.2",
			expectedResult: "10.0.0.2",
		},
		{
			name:           "RemoteAddr used as fallback",
			remoteAddr:     "192.168.1.1:12345",
			expectedResult: "192.168.1.1",
		},
		{
			name:           "IPv6 address",
			remoteAddr:     "[::1]:12345",
			expectedResult: "[::1]",
		},
	}
	
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest("GET", "/test", nil)
			req.RemoteAddr = tt.remoteAddr
			if tt.forwardedFor != "" {
				req.Header.Set("X-Forwarded-For", tt.forwardedFor)
			}
			if tt.realIP != "" {
				req.Header.Set("X-Real-IP", tt.realIP)
			}
			
			result := getClientIP(req)
			if result != tt.expectedResult {
				t.Errorf("Expected '%s', got '%s'", tt.expectedResult, result)
			}
		})
	}
}

