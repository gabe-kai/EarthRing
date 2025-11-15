# Authentication Package

This package provides authentication and security functionality for the EarthRing server.

## Features

- **JWT-based Authentication**: Access tokens (15 min) and refresh tokens (7 days)
- **Password Security**: bcrypt hashing with configurable cost
- **Password Validation**: Strong password requirements (8+ chars, uppercase, lowercase, number, special)
- **Token Management**: Token generation, validation, and refresh
- **Authentication Middleware**: Protect routes with JWT validation
- **Role-based Authorization**: Require specific roles for endpoints
- **Security Headers**: HTTP security headers middleware

## Components

### JWTService

Handles JWT token operations:
- `GenerateAccessToken(userID, username, role)`: Creates a new access token
- `GenerateRefreshToken(userID)`: Creates a new refresh token
- `ValidateAccessToken(token)`: Validates and parses an access token
- `ValidateRefreshToken(token)`: Validates and parses a refresh token

### PasswordService

Handles password operations:
- `HashPassword(password)`: Hashes a password using bcrypt
- `VerifyPassword(password, hash)`: Verifies a password against a hash
- `ValidatePasswordStrength(password)`: Validates password meets requirements

### AuthHandlers

HTTP handlers for authentication endpoints:
- `Register`: User registration (`POST /api/auth/register`)
- `Login`: User login (`POST /api/auth/login`)
- `Refresh`: Token refresh (`POST /api/auth/refresh`)
- `Logout`: User logout (`POST /api/auth/logout`)

### Middleware

- `AuthMiddleware`: Validates JWT tokens and adds user info to request context
- `RequireRole(role)`: Ensures user has required role
- `SecurityHeadersMiddleware`: Adds security headers to responses

## Usage

### Setup

```go
import (
    "github.com/earthring/server/internal/auth"
    "github.com/earthring/server/internal/config"
)

// Load configuration
cfg, _ := config.Load()

// Create services
jwtService := auth.NewJWTService(cfg)
passwordService := auth.NewPasswordService(cfg)
authHandlers := auth.NewAuthHandlers(db, jwtService, passwordService)

// Set up routes
mux.HandleFunc("/api/auth/register", authHandlers.Register)
mux.HandleFunc("/api/auth/login", authHandlers.Login)
mux.HandleFunc("/api/auth/refresh", authHandlers.Refresh)
mux.HandleFunc("/api/auth/logout", authHandlers.Logout)
```

### Protecting Routes

```go
// Apply authentication middleware
protectedHandler := authHandlers.AuthMiddleware(http.HandlerFunc(myHandler))

// Require specific role
adminHandler := authHandlers.RequireRole("admin")(
    authHandlers.AuthMiddleware(http.HandlerFunc(adminOnlyHandler)),
)
```

### Accessing User Info

```go
func myHandler(w http.ResponseWriter, r *http.Request) {
    userID, ok := auth.GetUserID(r)
    if !ok {
        http.Error(w, "Unauthorized", http.StatusUnauthorized)
        return
    }
    
    username, _ := auth.GetUsername(r)
    role, _ := auth.GetRole(r)
    
    // Use user info...
}
```

### Security Headers

```go
// Apply security headers to all routes
mux := http.NewServeMux()
mux.Handle("/", auth.SecurityHeadersMiddleware(myHandler))
```

## API Endpoints

### POST /api/auth/register

Register a new user.

**Request:**
```json
{
  "username": "player1",
  "email": "player@example.com",
  "password": "SecurePass123!"
}
```

**Response:**
```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refresh_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expires_at": "2024-01-01T00:15:00Z",
  "user_id": 123,
  "username": "player1",
  "role": "player"
}
```

### POST /api/auth/login

Login with username and password.

**Request:**
```json
{
  "username": "player1",
  "password": "SecurePass123!"
}
```

**Response:** Same as register

### POST /api/auth/refresh

Refresh access token using refresh token.

**Headers:**
```
Authorization: Bearer <refresh_token>
```

**Response:** Same as register/login

### POST /api/auth/logout

Logout (client should discard tokens).

**Response:**
```json
{
  "message": "Logged out successfully"
}
```

## Configuration

Required environment variables (see `server/internal/config/`):

- `JWT_SECRET`: Secret key for signing access tokens (min 32 bytes)
- `JWT_REFRESH_SECRET`: Secret key for signing refresh tokens (min 32 bytes)
- `JWT_EXPIRATION`: Access token expiration duration (default: 15m)
- `JWT_REFRESH_EXPIRATION`: Refresh token expiration duration (default: 168h)
- `BCRYPT_COST`: bcrypt cost factor (default: 12)

## Testing

Run tests:
```bash
go test ./internal/auth/... -v
```

## Security Considerations

- **Password Requirements**: Minimum 8 characters, must include uppercase, lowercase, number, and special character
- **Token Expiration**: Short-lived access tokens (15 min) reduce risk if compromised
- **Token Rotation**: Refresh tokens are rotated on each refresh
- **bcrypt Cost**: Default cost of 12 provides good security/performance balance
- **Security Headers**: All responses include security headers to prevent common attacks

## Future Enhancements

- Token revocation/blacklist (requires Redis or database)
- Rate limiting for authentication endpoints
- Two-factor authentication (2FA)
- Password reset functionality
- Account lockout after failed login attempts
- Role column in database (currently defaults to "player")

