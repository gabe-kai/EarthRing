package api

import (
	"fmt"
	"log"
	"net/http"
	"strconv"
	"time"

	"github.com/earthring/server/internal/auth"
	limiter "github.com/ulule/limiter/v3"
	"github.com/ulule/limiter/v3/drivers/store/memory"
)

const (
	rateLimitExceededJSON = `{"error":"Rate limit exceeded","message":"Too many requests. Please try again later.","retry_after":%d}`
)

// RateLimitConfig holds rate limit configuration
type RateLimitConfig struct {
	// Global rate limit (all endpoints)
	GlobalLimit  int
	GlobalWindow time.Duration

	// Per-user rate limit (authenticated endpoints)
	UserLimit  int
	UserWindow time.Duration

	// Per-endpoint rate limits
	AuthLimit  int // Authentication endpoints (register, login)
	AuthWindow time.Duration
}

// DefaultRateLimitConfig returns default rate limit configuration
func DefaultRateLimitConfig() RateLimitConfig {
	return RateLimitConfig{
		GlobalLimit:  1000,
		GlobalWindow: 1 * time.Minute,
		UserLimit:    500,
		UserWindow:   1 * time.Minute,
		AuthLimit:    5,
		AuthWindow:   1 * time.Minute,
	}
}

// RateLimitMiddleware creates a rate limiting middleware
func RateLimitMiddleware(limit int, window time.Duration) func(http.Handler) http.Handler {
	// Create rate limiter with memory store
	store := memory.NewStore()
	rate := limiter.Rate{
		Period: window,
		Limit:  int64(limit),
	}

	instance := limiter.New(store, rate)

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// Get client identifier (IP address)
			key := getClientIP(r)

			// Check rate limit
			context, err := instance.Get(r.Context(), key)
			if err != nil {
				// If rate limiter fails, allow request but log error
				// This prevents rate limiter from breaking the service
				fmt.Printf("Rate limiter error: %v\n", err)
				next.ServeHTTP(w, r)
				return
			}

			// Set rate limit headers
			w.Header().Set("X-RateLimit-Limit", strconv.FormatInt(context.Limit, 10))
			w.Header().Set("X-RateLimit-Remaining", strconv.FormatInt(context.Remaining, 10))
			w.Header().Set("X-RateLimit-Reset", strconv.FormatInt(context.Reset, 10))

			// Check if rate limit exceeded
			if context.Reached {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusTooManyRequests)

				retryAfter := int(time.Until(time.Unix(context.Reset, 0)).Seconds())
				if retryAfter < 0 {
					retryAfter = 0
				}

				// Write JSON response
				if _, err := fmt.Fprintf(w, rateLimitExceededJSON, retryAfter); err != nil {
					// Error writing response - connection may be closed
					return
				}
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}

// UserRateLimitMiddleware creates a rate limiting middleware for authenticated users
// Uses user ID from context instead of IP address
func UserRateLimitMiddleware(limit int, window time.Duration) func(http.Handler) http.Handler {
	// Create rate limiter with memory store
	store := memory.NewStore()
	rate := limiter.Rate{
		Period: window,
		Limit:  int64(limit),
	}

	instance := limiter.New(store, rate)

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// Try to get user ID from context
			userID, ok := auth.GetUserID(r)
			if !ok {
				// If not authenticated, fall back to IP-based limiting
				key := getClientIP(r)
				context, err := instance.Get(r.Context(), key)
				if err != nil {
					next.ServeHTTP(w, r)
					return
				}

				w.Header().Set("X-RateLimit-Limit", strconv.FormatInt(context.Limit, 10))
				w.Header().Set("X-RateLimit-Remaining", strconv.FormatInt(context.Remaining, 10))
				w.Header().Set("X-RateLimit-Reset", strconv.FormatInt(context.Reset, 10))

				if context.Reached {
					w.Header().Set("Content-Type", "application/json")
					w.WriteHeader(http.StatusTooManyRequests)
					retryAfter := int(time.Until(time.Unix(context.Reset, 0)).Seconds())
					if retryAfter < 0 {
						retryAfter = 0
					}
					if _, err := fmt.Fprintf(w, rateLimitExceededJSON, retryAfter); err != nil {
						log.Printf("Error writing rate limit response: %v", err)
					}
					return
				}

				next.ServeHTTP(w, r)
				return
			}

			// Use user ID as key for authenticated users
			key := fmt.Sprintf("user:%d", userID)

			// Check rate limit
			context, err := instance.Get(r.Context(), key)
			if err != nil {
				fmt.Printf("Rate limiter error: %v\n", err)
				next.ServeHTTP(w, r)
				return
			}

			// Set rate limit headers
			w.Header().Set("X-RateLimit-Limit", strconv.FormatInt(context.Limit, 10))
			w.Header().Set("X-RateLimit-Remaining", strconv.FormatInt(context.Remaining, 10))
			w.Header().Set("X-RateLimit-Reset", strconv.FormatInt(context.Reset, 10))

			// Check if rate limit exceeded
			if context.Reached {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusTooManyRequests)

				retryAfter := int(time.Until(time.Unix(context.Reset, 0)).Seconds())
				if retryAfter < 0 {
					retryAfter = 0
				}

				if _, err := fmt.Fprintf(w, rateLimitExceededJSON, retryAfter); err != nil {
					log.Printf("Error writing rate limit response: %v", err)
				}
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}

// getClientIP extracts the client IP address from the request
// Handles X-Forwarded-For header for proxied requests
func getClientIP(r *http.Request) string {
	// Check X-Forwarded-For header (for proxies/load balancers)
	forwarded := r.Header.Get("X-Forwarded-For")
	if forwarded != "" {
		// X-Forwarded-For can contain multiple IPs, take the first one
		return forwarded
	}

	// Check X-Real-IP header (alternative proxy header)
	realIP := r.Header.Get("X-Real-IP")
	if realIP != "" {
		return realIP
	}

	// Fall back to RemoteAddr
	ip := r.RemoteAddr
	// Remove port if present (e.g., "127.0.0.1:12345" -> "127.0.0.1")
	for i := len(ip) - 1; i >= 0; i-- {
		if ip[i] == ':' {
			return ip[:i]
		}
	}

	return ip
}
