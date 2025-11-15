# API Package

This package provides HTTP API routing, middleware, and utilities for the EarthRing server.

## Components

### Rate Limiting

Rate limiting middleware to prevent abuse and DoS attacks.

**Features:**
- IP-based rate limiting for unauthenticated requests
- User-based rate limiting for authenticated requests
- Configurable limits and time windows
- Standard rate limit headers (`X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`)
- Proper error responses with retry-after information

**Usage:**

```go
import "github.com/earthring/server/internal/api"

// Create rate limit middleware (5 requests per minute)
rateLimit := api.RateLimitMiddleware(5, 1*time.Minute)

// Apply to handler
handler := rateLimit(http.HandlerFunc(myHandler))
```

**Rate Limit Tiers:**

1. **Global Rate Limit**: 1000 requests per minute per IP (applied to all routes)
2. **Authentication Endpoints**: 5 requests per minute per IP (register, login, refresh, logout)
3. **Per-User Rate Limit**: 500 requests per minute per user (for authenticated endpoints)

**Rate Limit Headers:**

All responses include rate limit headers:
- `X-RateLimit-Limit`: Maximum requests allowed
- `X-RateLimit-Remaining`: Remaining requests in current window
- `X-RateLimit-Reset`: Unix timestamp when limit resets

**Rate Limit Exceeded Response:**

When rate limit is exceeded, returns `429 Too Many Requests`:

```json
{
  "error": "Rate limit exceeded",
  "message": "Too many requests. Please try again later.",
  "retry_after": 60
}
```

### CORS Middleware

CORS middleware to allow cross-origin requests from web clients.

**Allowed Origins:**
- `http://localhost:3000` (Vite dev server)
- `http://localhost:5173` (Vite default port)
- `http://127.0.0.1:3000`
- `http://127.0.0.1:5173`

**Usage:**

```go
handler := api.CORSMiddleware(mux)
```

### Authentication Routes

Sets up authentication endpoints with rate limiting:

- `POST /api/auth/register` - User registration
- `POST /api/auth/login` - User login
- `POST /api/auth/refresh` - Token refresh
- `POST /api/auth/logout` - User logout

**Usage:**

```go
api.SetupAuthRoutes(mux, db, cfg)
```

## Middleware Order

The middleware is applied in the following order (important for proper functioning):

1. **Rate Limiting** (per-endpoint, then global)
2. **CORS** (must be before security headers for OPTIONS requests)
3. **Security Headers** (applied to all responses)

## Client IP Detection

The rate limiter uses `getClientIP()` to extract client IP addresses, which:
1. Checks `X-Forwarded-For` header (for proxies/load balancers)
2. Checks `X-Real-IP` header (alternative proxy header)
3. Falls back to `RemoteAddr` from request

This ensures accurate rate limiting even behind proxies or load balancers.

## Testing

Run tests:
```bash
go test ./internal/api/... -v
```

## Future Enhancements

- Redis-backed rate limiting for distributed systems
- Configurable rate limits per endpoint via configuration
- Rate limit bypass for admin users
- Rate limit metrics and monitoring

