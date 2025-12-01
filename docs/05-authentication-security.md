# Authentication and Security Specification

**Status**: ✅ **IMPLEMENTED** - Authentication and security systems are fully implemented.

**Related Documentation**:
- [API Design](04-api-design.md) - Authentication endpoints
- [Client Architecture](06-client-architecture.md) - Client-side authentication handling

## Table of Contents

- [Overview](#overview)
- [Authentication Architecture](#authentication-architecture)
- [JWT Implementation](#jwt-implementation)
  - [JWT Library Choice](#jwt-library-choice)
  - [JWT Claims Structure](#jwt-claims-structure)
  - [Token Expiration](#token-expiration)
  - [Token Signing](#token-signing)
- [Token Refresh Strategy](#token-refresh-strategy)
  - [Refresh Token Mechanism](#refresh-token-mechanism)
  - [Automatic Refresh](#automatic-refresh)
  - [Refresh Token Storage](#refresh-token-storage)
- [Rate Limiting](#rate-limiting)
  - [Rate Limiting Strategy](#rate-limiting-strategy)
  - [Rate Limit Implementation](#rate-limit-implementation)
  - [Rate Limit Headers](#rate-limit-headers)
- [Input Validation](#input-validation)
  - [Validation Rules](#validation-rules)
  - [Validation Implementation](#validation-implementation)
  - [Error Responses](#error-responses)
- [SQL Injection Prevention](#sql-injection-prevention)
  - [Database Access Layer](#database-access-layer)
  - [Query Parameterization](#query-parameterization)
  - [ORM Usage](#orm-usage)
- [XSS Prevention](#xss-prevention)
  - [Client-Side Sanitization](#client-side-sanitization)
  - [Content Security Policy](#content-security-policy)
  - [Output Encoding](#output-encoding)
- [WebSocket Security](#websocket-security)
  - [Authentication](#authentication)
  - [Message Validation](#message-validation)
- [Password Security](#password-security)
  - [Password Hashing](#password-hashing)
  - [Password Requirements](#password-requirements)
- [Session Management](#session-management)
- [Security Headers](#security-headers)
- [Security Monitoring](#security-monitoring)
- [Open Questions](#open-questions)
- [Future Considerations](#future-considerations)

## Overview

This document specifies the authentication and security implementation for EarthRing. Security is critical for a multiplayer game handling player data, game state, and real-time interactions. All security measures are implemented server-side, with client-side protections as defense-in-depth.

**Security Principles:**
- **Defense in Depth**: Multiple layers of security
- **Least Privilege**: Users have minimum necessary permissions
- **Fail Secure**: System fails in secure state
- **Never Trust Client**: All validation server-side
- **Secure by Default**: Secure configuration is default

## Authentication Architecture

### Authentication Flow

```
1. User Registration/Login
   ↓
2. Server validates credentials
   ↓
3. Server generates JWT access token + refresh token
   ↓
4. Client stores tokens securely
   ↓
5. Client includes access token in requests
   ↓
6. Server validates token on each request
   ↓
7. If token expired, client uses refresh token
   ↓
8. Server issues new access token
```

### Authentication Methods

**Primary**: JWT-based authentication
- Access tokens for API requests
- Refresh tokens for token renewal
- Stateless authentication (no server-side session storage)

**WebSocket**: Token-based authentication
- Token passed during WebSocket handshake
- Token validated before connection established
- Connection closed if token invalid

## JWT Implementation

**Implementation Status:** ✅ **IMPLEMENTED** (see `server/internal/auth/jwt.go`)

### JWT Library Choice

**Decision**: Use `github.com/golang-jwt/jwt/v5` for Go server

**Rationale**:
- Official Go JWT library (well-maintained)
- Supports all required JWT features
- Good performance
- Active security updates
- Widely used in Go community

**Alternative Considered**: `github.com/dgrijalva/jwt-go` (deprecated, not recommended)

### JWT Claims Structure

**Standard Claims:**
```go
type Claims struct {
    jwt.RegisteredClaims
    
    // Custom claims
    UserID    int64  `json:"user_id"`
    Username  string `json:"username"`
    Role      string `json:"role"`      // "player", "admin", "infrastructure_manager"
    ExpiresAt int64  `json:"exp"`
}
```

**Registered Claims Used:**
- `iss` (Issuer): "earthring-server"
- `sub` (Subject): User ID
- `exp` (Expiration Time): Token expiration timestamp
- `iat` (Issued At): Token creation timestamp
- `jti` (JWT ID): Unique token identifier (for revocation tracking)

**Custom Claims:**
- `user_id`: Player's database ID
- `username`: Player's username (for logging/debugging)
- `role`: Player's role (for authorization)

**Token Example:**
```json
{
  "iss": "earthring-server",
  "sub": "123",
  "user_id": 123,
  "username": "player1",
  "role": "player",
  "exp": 1704067200,
  "iat": 1704063600,
  "jti": "abc123def456"
}
```

### Token Expiration

**Access Token Expiration:**
- **Duration**: 15 minutes
- **Rationale**: Short-lived tokens reduce risk if compromised
- **Refresh**: Automatic refresh before expiration (see Refresh Strategy)

**Refresh Token Expiration:**
- **Duration**: 7 days
- **Rationale**: Balance between security and user convenience
- **Rotation**: New refresh token issued on each refresh

**Token Expiration Handling:**
- Server returns `401 Unauthorized` with `TokenExpired` error
- Client automatically attempts refresh
- If refresh fails, client automatically logs out user and redirects to sign-in page
- Prevents console spam and provides clear user feedback

### Token Signing

**Algorithm**: HS256 (HMAC-SHA256)

**Key Management:**
- Secret key stored in environment variable
- Key rotated periodically (every 90 days)
- Old keys kept for token validation during rotation period
- Key length: Minimum 256 bits (32 bytes)

**Key Rotation Strategy:**
1. Generate new key
2. Add to key ring (support multiple keys)
3. New tokens signed with new key
4. Old tokens validated with old key
5. After rotation period, remove old key

**Implementation:**
```go
// Key stored in environment
var jwtSecret = []byte(os.Getenv("JWT_SECRET"))

// Signing
token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
tokenString, err := token.SignedString(jwtSecret)

// Validation
token, err := jwt.ParseWithClaims(tokenString, &Claims{}, func(token *jwt.Token) (interface{}, error) {
    return jwtSecret, nil
})
```

## Token Refresh Strategy

**Implementation Status:** ✅ **IMPLEMENTED** (see `server/internal/auth/handlers.go`)

### Refresh Token Mechanism

**Decision**: Automatic refresh with refresh tokens

**Flow:**
1. Client receives access token (15 min) + refresh token (7 days) on login
2. Client tracks access token expiration time
3. Client automatically refreshes 2 minutes before expiration
4. Server validates refresh token and issues new access token
5. Server optionally issues new refresh token (rotation)

### Automatic Refresh

**Client-Side Implementation:**
- Track token expiration time
- Set timer to refresh 2 minutes before expiration
- Refresh in background (don't interrupt user)
- Retry on failure (exponential backoff)

**Refresh Endpoint:**
```
POST /api/auth/refresh
Headers: {
  "Authorization": "Bearer <refresh_token>"
}
Response: {
  "access_token": "new_jwt_token",
  "refresh_token": "new_refresh_token",  // Optional rotation
  "expires_at": "2024-01-01T00:15:00Z"
}
```

**Refresh Token Rotation:**
- **Decision**: Rotate refresh tokens on each refresh
- **Rationale**: Limits impact of token theft
- **Implementation**: Issue new refresh token, invalidate old one

### Refresh Token Storage

**Client-Side Storage:**
- **Web Client**: localStorage (acceptable for refresh tokens)
- **Future Clients**: Secure keychain/credential store

**Security Considerations:**
- Refresh tokens are long-lived but can be revoked
- Server maintains refresh token blacklist (for revocation)
- Refresh tokens stored separately from access tokens

**Token Revocation:**
- Server maintains blacklist of revoked tokens (Redis or database)
- Check blacklist on refresh request
- Blacklist persists for token expiration period

## Rate Limiting

### Rate Limiting Strategy

**Decision**: Multi-tier rate limiting (per-user, per-endpoint, global)

**Rationale:**
- Prevent abuse and DoS attacks
- Protect server resources
- Fair usage across players

### Rate Limit Implementation

**Library Choice**: `github.com/ulule/limiter/v3` (Go)

**Rate Limit Tiers:**

1. **Global Rate Limit** (All endpoints)
   - **Limit**: 1000 requests per minute per IP
   - **Purpose**: Prevent DoS attacks
   - **Storage**: Redis (shared across server instances)

2. **Per-User Rate Limit** (Authenticated endpoints)
   - **Limit**: 500 requests per minute per user
   - **Purpose**: Prevent abuse by authenticated users
   - **Storage**: Redis (key: `rate_limit:user:{user_id}`)

3. **Per-Endpoint Rate Limits** (Specific endpoints)
   - **Authentication**: 5 requests per minute per IP
   - **Zone Creation**: 10 requests per minute per user
   - **Structure Placement**: 20 requests per minute per user
   - **Chunk Requests**: 100 requests per minute per user
   - **WebSocket Messages**: 1000 messages per minute per connection

**Rate Limit Algorithm:**
- **Algorithm**: Token bucket (via `github.com/ulule/limiter/v3`)
- **Window**: Sliding window (more accurate than fixed window)
- **Storage**: Memory store (in-memory, per-server instance)

**Implementation Status:** ✅ **IMPLEMENTED**

**Implementation:**
```go
// Rate limiter middleware (server/internal/api/ratelimit.go)
func RateLimitMiddleware(limit int, window time.Duration) func(http.Handler) http.Handler {
    store := memory.NewStore()
    rate := limiter.Rate{
        Period: window,
        Limit:  int64(limit),
    }
    instance := limiter.New(store, rate)
    
    return func(next http.Handler) http.Handler {
        return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
            key := getClientIP(r) // IP address
            context, err := instance.Get(r.Context(), key)
            if err != nil {
                // Allow request if rate limiter fails (fail-open)
                next.ServeHTTP(w, r)
                return
            }
            
            // Set rate limit headers
            w.Header().Set("X-RateLimit-Limit", strconv.FormatInt(context.Limit, 10))
            w.Header().Set("X-RateLimit-Remaining", strconv.FormatInt(context.Remaining, 10))
            w.Header().Set("X-RateLimit-Reset", strconv.FormatInt(context.Reset, 10))
            
            if context.Reached {
                w.Header().Set("Content-Type", "application/json")
                w.WriteHeader(http.StatusTooManyRequests)
                // Return JSON error response
                return
            }
            
            next.ServeHTTP(w, r)
        })
    }
}
```

**Note**: Currently using memory store. For distributed systems, Redis store can be configured (see `github.com/ulule/limiter/v3/drivers/store/redis`).

### Rate Limit Headers

**Standard Headers:**
- `X-RateLimit-Limit`: Maximum requests allowed
- `X-RateLimit-Remaining`: Remaining requests in window
- `X-RateLimit-Reset`: Unix timestamp when limit resets

**Example Response:**
```
HTTP/1.1 200 OK
X-RateLimit-Limit: 500
X-RateLimit-Remaining: 499
X-RateLimit-Reset: 1704067200
```

**Rate Limit Exceeded Response:**
```
HTTP/1.1 429 Too Many Requests
X-RateLimit-Limit: 500
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1704067200
Content-Type: application/json

{
  "error": "Rate limit exceeded",
  "message": "Too many requests. Please try again later.",
  "retry_after": 60
}
```

## Input Validation

**Implementation Status:** ✅ **IMPLEMENTED** (see `server/internal/auth/models.go` and `server/internal/auth/handlers.go`)

### Validation Rules

**All Input Must Be Validated:**
- Request body (JSON)
- Query parameters
- URL parameters
- Headers (where applicable)
- WebSocket messages

**Validation Rules by Input Type:**

1. **Strings**
   - Maximum length enforced
   - Character set validation (UTF-8, no control characters)
   - Trim whitespace
   - Sanitize for storage

2. **Numbers**
   - Type validation (int, float)
   - Range validation (min/max)
   - Precision validation (decimal places)

3. **Coordinates**
   - Range validation (X: 0-264000000, Y: -12500 to +12500, Z: integer)
   - Type validation (numbers)
   - Wrapping validation (X wraps at 264000000)

4. **Polygons (Zones)**
   - Minimum 3 vertices
   - Maximum vertices: 1000 (configurable, performance consideration)
   - No self-intersections
   - Within map bounds
   - Simple polygon (no holes initially)

5. **IDs**
   - Positive integers
   - Exist in database (for foreign keys)

6. **Enums**
   - Must match allowed values
   - Case-sensitive matching

### Validation Implementation

**Library Choice**: `github.com/go-playground/validator/v10` (Go)

**Validation Tags:**
```go
type CreateZoneRequest struct {
    Name     string   `json:"name" validate:"required,min=1,max=100"`
    ZoneType string   `json:"zone_type" validate:"required,oneof=residential commercial industrial"`
    Geometry Polygon  `json:"geometry" validate:"required"`
    Floor    int      `json:"floor" validate:"required,min=-2,max=15"`
    Density  string   `json:"density" validate:"omitempty,oneof=low medium high"`
}

type Polygon struct {
    Type        string    `json:"type" validate:"required,eq=Polygon"`
    Coordinates [][]Point `json:"coordinates" validate:"required,min=3,max=1000"`
}
```

**Custom Validators:**
- Polygon validation (self-intersection check)
- Coordinate range validation
- Coordinate wrapping validation
- Zone overlap validation

**Validation Middleware:**
```go
func ValidateRequest(schema interface{}) gin.HandlerFunc {
    validate := validator.New()
    return func(c *gin.Context) {
        var req schema
        if err := c.ShouldBindJSON(&req); err != nil {
            c.JSON(400, gin.H{"error": "Invalid request", "details": err.Error()})
            c.Abort()
            return
        }
        
        if err := validate.Struct(req); err != nil {
            errors := formatValidationErrors(err)
            c.JSON(400, gin.H{"error": "Validation failed", "details": errors})
            c.Abort()
            return
        }
        
        c.Set("validated_request", req)
        c.Next()
    }
}
```

### Error Responses

**Validation Error Format:**
```json
{
  "error": "Validation failed",
  "details": {
    "name": ["Name is required"],
    "zone_type": ["Zone type must be one of: residential, commercial, industrial"],
    "geometry.coordinates": ["Polygon must have at least 3 vertices"]
  }
}
```

**Error Codes:**
- `400 Bad Request`: Validation failed
- `401 Unauthorized`: Authentication failed
- `403 Forbidden`: Authorization failed
- `404 Not Found`: Resource not found
- `429 Too Many Requests`: Rate limit exceeded
- `500 Internal Server Error`: Server error

## SQL Injection Prevention

### Database Access Layer

**Decision**: Use parameterized queries exclusively, never string concatenation

**Approach**: Use database/sql package with prepared statements, or use an ORM

### Query Parameterization

**Always Use Parameterized Queries:**
```go
// ✅ CORRECT - Parameterized
query := "SELECT * FROM zones WHERE id = $1 AND floor = $2"
row := db.QueryRow(query, zoneID, floor)

// ❌ WRONG - String concatenation (vulnerable to SQL injection)
query := fmt.Sprintf("SELECT * FROM zones WHERE id = %d", zoneID)
row := db.QueryRow(query)
```

**PostgreSQL Placeholders:**
- Use `$1`, `$2`, `$3`, etc. (PostgreSQL style)
- Never use `?` (MySQL style) or string formatting

**Example:**
```go
func GetZoneByID(db *sql.DB, zoneID int64) (*Zone, error) {
    query := `
        SELECT id, name, zone_type, geometry, floor, created_at
        FROM zones
        WHERE id = $1
    `
    row := db.QueryRow(query, zoneID)
    
    var zone Zone
    err := row.Scan(&zone.ID, &zone.Name, &zone.ZoneType, &zone.Geometry, &zone.Floor, &zone.CreatedAt)
    if err != nil {
        return nil, err
    }
    return &zone, nil
}
```

### ORM Usage

**Decision**: Use lightweight ORM/library for convenience, but maintain control

**Library Choice**: `github.com/jmoiron/sqlx` (Go)

**Rationale:**
- Lightweight wrapper around database/sql
- Still uses parameterized queries
- Convenient struct scanning
- Doesn't hide SQL (maintains control)
- Good performance

**Alternative Considered**: GORM (too heavy, hides SQL, harder to optimize)

**Example Usage:**
```go
import "github.com/jmoiron/sqlx"

type Zone struct {
    ID       int64     `db:"id"`
    Name     string    `db:"name"`
    ZoneType string    `db:"zone_type"`
    Geometry []byte    `db:"geometry"` // PostGIS geometry
    Floor    int       `db:"floor"`
}

func GetZonesInChunk(db *sqlx.DB, chunkID int64) ([]Zone, error) {
    query := `
        SELECT z.*
        FROM zones z
        WHERE ST_Intersects(z.geometry, (SELECT geometry FROM chunks WHERE id = $1))
    `
    zones := []Zone{}
    err := db.Select(&zones, query, chunkID)
    return zones, err
}
```

**PostGIS Queries:**
- PostGIS functions are safe (they're functions, not user input)
- Still parameterize any user-provided values
- Use spatial functions correctly

**Example:**
```go
// ✅ CORRECT - Parameterized PostGIS query
query := `
    SELECT * FROM zones
    WHERE ST_Contains(geometry, ST_MakePoint($1, $2))
    AND floor = $3
`
rows, err := db.Query(query, x, y, floor)

// ❌ WRONG - String formatting in PostGIS query
query := fmt.Sprintf(`
    SELECT * FROM zones
    WHERE ST_Contains(geometry, ST_MakePoint(%f, %f))
`, x, y)
```

## XSS Prevention

### Client-Side Sanitization

**Decision**: Sanitize all user-generated content before rendering

**Library Choice**: `DOMPurify` (JavaScript) for web client

**Rationale:**
- Industry standard for XSS prevention
- Actively maintained
- Good performance
- Handles all XSS vectors

**Usage:**
```javascript
import DOMPurify from 'dompurify';

// Sanitize user input before rendering
const cleanHTML = DOMPurify.sanitize(userInput);

// Sanitize for specific context
const cleanText = DOMPurify.sanitize(userInput, { 
    ALLOWED_TAGS: [] // Strip all HTML, text only
});
```

**Sanitization Rules:**
- **Zone Names**: Text only (strip all HTML)
- **Zone Descriptions**: Limited HTML (bold, italic, links only)
- **Chat Messages**: Text only (strip all HTML)
- **Structure Names**: Text only (strip all HTML)

### Content Security Policy

**CSP Headers:**
```
Content-Security-Policy: 
    default-src 'self';
    script-src 'self' 'unsafe-inline' 'unsafe-eval';  // Three.js requires unsafe-eval
    style-src 'self' 'unsafe-inline';
    img-src 'self' data: https:;
    connect-src 'self' wss:;
    font-src 'self' data:;
    object-src 'none';
    base-uri 'self';
    form-action 'self';
```

**Rationale:**
- Prevents XSS attacks
- Restricts resource loading
- `unsafe-eval` required for Three.js (unavoidable)
- `unsafe-inline` for styles (can be improved with nonces later)

### Output Encoding

**Server-Side:**
- All JSON responses properly encoded (Go's `json.Marshal` handles this)
- No HTML in JSON responses (use text/plain for HTML if needed)

**Client-Side:**
- Use textContent instead of innerHTML where possible
- Sanitize before innerHTML
- Use framework's built-in escaping (React, Vue, etc. escape by default)

**Example:**
```javascript
// ✅ CORRECT - Use textContent
element.textContent = userInput;

// ✅ CORRECT - Sanitize before innerHTML
element.innerHTML = DOMPurify.sanitize(userInput);

// ❌ WRONG - Direct innerHTML
element.innerHTML = userInput;
```

## WebSocket Security

**Implementation Status:** ✅ **IMPLEMENTED** (see `server/internal/api/websocket.go`)

### Authentication

**Client-Side Authentication Error Handling:**
- WebSocket client detects authentication errors in messages (`InvalidToken`, `MissingToken`, or authentication-related error text)
- On authentication errors, client automatically calls `handleAuthenticationFailure()` to log out user
- WebSocket connection is closed on authentication errors to prevent reconnection attempts
- Prevents console spam and provides clear user feedback when authentication fails

**Token in Handshake:**
- Token passed as query parameter: `wss://api.earthring.game/ws?token=<jwt_token>`
- Alternative: Token in `Authorization` header (if WebSocket library supports)

**Token Validation:**
- Validate token before accepting connection
- Reject connection if token invalid/expired
- Close connection if token becomes invalid during session

**Implementation:**
```go
func WebSocketAuthMiddleware() gin.HandlerFunc {
    return func(c *gin.Context) {
        token := c.Query("token")
        if token == "" {
            c.AbortWithStatus(401)
            return
        }
        
        claims, err := validateJWT(token)
        if err != nil {
            c.AbortWithStatus(401)
            return
        }
        
        c.Set("user_id", claims.UserID)
        c.Set("username", claims.Username)
        c.Next()
    }
}
```

### Message Validation

**All WebSocket Messages Validated:**
- Message structure validation
- Field type validation
- Field value validation (ranges, enums)
- Rate limiting per connection

**Message Validation:**
```go
func ValidateWebSocketMessage(msg WebSocketMessage) error {
    // Validate message type
    allowedTypes := []string{"stream_subscribe", "stream_update_pose", "player_move", "zone_create"}
    if !contains(allowedTypes, msg.Type) {
        return errors.New("invalid message type")
    }
    
    // Validate based on type
    switch msg.Type {
    case "stream_subscribe":
        return validateStreamSubscribe(msg.Data)
    case "stream_update_pose":
        return validateStreamUpdatePose(msg.Data)
    case "player_move":
        return validatePlayerMove(msg.Data)
    // ... etc
    }
    
    return nil
}
```

## Password Security

**Implementation Status:** ✅ **IMPLEMENTED** (see `server/internal/auth/password.go`)

### Password Hashing

**Algorithm**: bcrypt

**Library**: `golang.org/x/crypto/bcrypt`

**Cost Factor**: 12 (balance between security and performance)

**Implementation:**
```go
import "golang.org/x/crypto/bcrypt"

// Hash password
func HashPassword(password string) (string, error) {
    bytes, err := bcrypt.GenerateFromPassword([]byte(password), 12)
    return string(bytes), err
}

// Verify password
func CheckPasswordHash(password, hash string) bool {
    err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(password))
    return err == nil
}
```

**Password Storage:**
- Never store plaintext passwords
- Store only bcrypt hash
- Hash includes salt (bcrypt handles this)

### Password Requirements

**Minimum Requirements:**
- **Length**: Minimum 8 characters, maximum 128 characters
- **Complexity**: At least one uppercase, one lowercase, one number
- **Special Characters**: Optional (not required, improves security if present)

**Rationale:**
- Balance between security and usability
- Common password requirements
- Prevents weak passwords

**Validation:**
```go
func ValidatePassword(password string) error {
    if len(password) < 8 {
        return errors.New("password must be at least 8 characters")
    }
    if len(password) > 128 {
        return errors.New("password must be less than 128 characters")
    }
    
    hasUpper := false
    hasLower := false
    hasNumber := false
    
    for _, char := range password {
        switch {
        case 'A' <= char && char <= 'Z':
            hasUpper = true
        case 'a' <= char && char <= 'z':
            hasLower = true
        case '0' <= char && char <= '9':
            hasNumber = true
        }
    }
    
    if !hasUpper || !hasLower || !hasNumber {
        return errors.New("password must contain at least one uppercase, one lowercase, and one number")
    }
    
    return nil
}
```

**Password Reset:**
- Secure token-based reset (not email-based questions)
- Token expires after 1 hour
- Token single-use (invalidated after use)
- Rate limit: 3 reset requests per hour per email

## Session Management

**Stateless Authentication:**
- No server-side session storage
- All state in JWT tokens
- Refresh tokens stored client-side

**Token Revocation:**
- Maintain blacklist of revoked tokens (Redis)
- Check blacklist on each request
- Blacklist entry expires with token expiration

**Logout:**
- Client discards tokens
- Server adds tokens to blacklist (optional, for security)
- Refresh token invalidated

**Implementation:**
```go
// Token blacklist (Redis)
func RevokeToken(tokenID string, expiresAt time.Time) error {
    ttl := time.Until(expiresAt)
    return redis.Set(ctx, "blacklist:"+tokenID, "1", ttl).Err()
}

func IsTokenRevoked(tokenID string) (bool, error) {
    exists, err := redis.Exists(ctx, "blacklist:"+tokenID).Result()
    return exists > 0, err
}
```

## Security Headers

**Implementation Status:** ✅ **IMPLEMENTED** (see `server/internal/auth/security_headers.go`)

**HTTP Security Headers:**
```
Strict-Transport-Security: max-age=31536000; includeSubDomains
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
X-XSS-Protection: 1; mode=block
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: geolocation=(), microphone=(), camera=()
```

**Implementation (Go/Gin):**
```go
func SecurityHeaders() gin.HandlerFunc {
    return func(c *gin.Context) {
        c.Header("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
        c.Header("X-Content-Type-Options", "nosniff")
        c.Header("X-Frame-Options", "DENY")
        c.Header("X-XSS-Protection", "1; mode=block")
        c.Header("Referrer-Policy", "strict-origin-when-cross-origin")
        c.Header("Permissions-Policy", "geolocation=(), microphone=(), camera=()")
        c.Next()
    }
}
```

## Security Monitoring

**Logging:**
- Log all authentication attempts (success and failure)
- Log rate limit violations
- Log validation failures
- Log security-related errors

**Monitoring:**
- Track failed login attempts (alert on brute force)
- Track rate limit violations (alert on DoS attempts)
- Track token refresh patterns (detect anomalies)
- Monitor for SQL injection attempts (log suspicious queries)

**Alerting:**
- Failed login attempts: >10 per minute from same IP
- Rate limit violations: >100 per minute from same IP
- Token refresh failures: >50% failure rate
- SQL errors: Alert on any SQL syntax errors (possible injection)

## Open Questions

1. Should we implement 2FA (two-factor authentication)?
2. Should we support OAuth providers (Google, GitHub, etc.)?
3. Should we implement account lockout after failed attempts?
4. Should we implement IP whitelisting for admin accounts?

## Future Considerations

- **2FA Support**: Add two-factor authentication for enhanced security
- **OAuth Integration**: Support social login (Google, GitHub, etc.)
- **Account Lockout**: Lock accounts after multiple failed login attempts
- **IP Whitelisting**: Whitelist IPs for admin/infrastructure manager accounts
- **Audit Logging**: Comprehensive audit log of all security events
- **Security Scanning**: Automated security scanning of dependencies
- **Penetration Testing**: Regular security audits and penetration testing
- **Bug Bounty Program**: Reward security researchers for finding vulnerabilities

