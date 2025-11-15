package api

import (
	"net/http"
)

// CORSMiddleware adds CORS headers to allow cross-origin requests
// In development, allows all origins. In production, should be restricted.
func CORSMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Get origin from request
		origin := r.Header.Get("Origin")
		
		// Allow specific origins (in development, allow localhost)
		allowedOrigins := []string{
			"http://localhost:3000",
			"http://localhost:5173", // Vite default port
			"http://127.0.0.1:3000",
			"http://127.0.0.1:5173",
		}
		
		// Check if origin is allowed
		allowed := false
		for _, allowedOrigin := range allowedOrigins {
			if origin == allowedOrigin {
				allowed = true
				break
			}
		}
		
		// Set CORS headers
		if allowed {
			w.Header().Set("Access-Control-Allow-Origin", origin)
		}
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		w.Header().Set("Access-Control-Allow-Credentials", "true")
		w.Header().Set("Access-Control-Max-Age", "3600")
		
		// Handle preflight requests
		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		
		next.ServeHTTP(w, r)
	})
}

