package auth

import (
	"context"
	"net/http"
	"strings"
)

// ContextKey is a type for context keys
type ContextKey string

const (
	// UserIDKey is the context key for user ID
	UserIDKey ContextKey = "user_id"
	// UsernameKey is the context key for username
	UsernameKey ContextKey = "username"
	// RoleKey is the context key for user role
	RoleKey ContextKey = "role"
	// ClaimsKey is the context key for JWT claims
	ClaimsKey ContextKey = "claims"
)

// AuthMiddleware validates JWT tokens and adds user info to request context
func (h *AuthHandlers) AuthMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Get token from Authorization header
		authHeader := r.Header.Get("Authorization")
		if authHeader == "" {
			h.sendError(w, http.StatusUnauthorized, "MissingToken", "Authorization header required")
			return
		}

		// Extract token from "Bearer <token>"
		parts := strings.Split(authHeader, " ")
		if len(parts) != 2 || parts[0] != "Bearer" {
			h.sendError(w, http.StatusUnauthorized, "InvalidToken", "Invalid authorization header format")
			return
		}

		tokenString := parts[1]

		// Validate token
		claims, err := h.jwtService.ValidateAccessToken(tokenString)
		if err != nil {
			h.sendError(w, http.StatusUnauthorized, "InvalidToken", "Invalid or expired token")
			return
		}

		// Add user info to context
		ctx := context.WithValue(r.Context(), UserIDKey, claims.UserID)
		ctx = context.WithValue(ctx, UsernameKey, claims.Username)
		ctx = context.WithValue(ctx, RoleKey, claims.Role)
		ctx = context.WithValue(ctx, ClaimsKey, claims)

		// Call next handler with updated context
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// RequireRole middleware ensures user has required role
func (h *AuthHandlers) RequireRole(requiredRole string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			role, ok := r.Context().Value(RoleKey).(string)
			if !ok || role != requiredRole {
				h.sendError(w, http.StatusForbidden, "InsufficientPermissions", "Insufficient permissions")
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// GetUserID extracts user ID from request context
func GetUserID(r *http.Request) (int64, bool) {
	userID, ok := r.Context().Value(UserIDKey).(int64)
	return userID, ok
}

// GetUsername extracts username from request context
func GetUsername(r *http.Request) (string, bool) {
	username, ok := r.Context().Value(UsernameKey).(string)
	return username, ok
}

// GetRole extracts role from request context
func GetRole(r *http.Request) (string, bool) {
	role, ok := r.Context().Value(RoleKey).(string)
	return role, ok
}

// GetClaims extracts JWT claims from request context
func GetClaims(r *http.Request) (*Claims, bool) {
	claims, ok := r.Context().Value(ClaimsKey).(*Claims)
	return claims, ok
}
