# Configuration Management

The configuration system provides a centralized way to manage all server settings through environment variables and `.env` files.

## Usage

### Loading Configuration

```go
import "github.com/earthring/server/internal/config"

func main() {
    cfg, err := config.Load()
    if err != nil {
        log.Fatalf("Failed to load configuration: %v", err)
    }
    
    // Use configuration
    fmt.Printf("Server starting on %s:%s\n", cfg.Server.Host, cfg.Server.Port)
}
```

### Configuration Structure

The `Config` struct contains:

- **Server**: Host, port, timeouts, environment
- **Database**: Connection settings, pool configuration
- **Auth**: JWT secrets, expiration times, bcrypt cost
- **Procedural**: Procedural generation service URL and settings
- **Logging**: Log level, format, output path

### Environment Variables

#### Server Configuration
- `SERVER_HOST` - Server host (default: `0.0.0.0`)
- `SERVER_PORT` - Server port (default: `8080`)
- `SERVER_READ_TIMEOUT` - Read timeout (default: `15s`)
- `SERVER_WRITE_TIMEOUT` - Write timeout (default: `15s`)
- `SERVER_IDLE_TIMEOUT` - Idle timeout (default: `60s`)
- `ENVIRONMENT` - Environment: `development`, `staging`, or `production` (default: `development`)

#### Database Configuration
- `DB_HOST` - Database host (default: `localhost`)
- `DB_PORT` - Database port (default: `5432`)
- `DB_USER` - Database user (default: `postgres`)
- `DB_PASSWORD` - Database password (**required**)
- `DB_NAME` - Database name (default: `earthring_dev`)
- `DB_SSLMODE` - SSL mode (default: `disable`)
- `DB_MAX_CONNECTIONS` - Max connections (default: `25`)
- `DB_MAX_IDLE_CONNS` - Max idle connections (default: `5`)
- `DB_CONN_MAX_LIFETIME` - Connection max lifetime (default: `5m`)

#### Authentication Configuration
- `JWT_SECRET` - JWT signing secret (**required**)
- `JWT_EXPIRATION` - JWT expiration time (default: `15m`)
- `REFRESH_SECRET` - Refresh token secret (**required**)
- `REFRESH_EXPIRATION` - Refresh token expiration (default: `168h` = 7 days)
- `BCRYPT_COST` - Bcrypt hashing cost (default: `10`)

#### Procedural Generation Service
- `PROCEDURAL_BASE_URL` - Service base URL (default: `http://127.0.0.1:8081`)
  - **Note**: Uses `127.0.0.1` instead of `localhost` for better Windows compatibility (avoids IPv6 resolution issues)
- `PROCEDURAL_TIMEOUT` - Request timeout (default: `30s`)
- `PROCEDURAL_RETRY_COUNT` - Retry attempts (default: `3`)

#### Logging Configuration
- `LOG_LEVEL` - Log level: `debug`, `info`, `warn`, `error` (default: `info`)
- `LOG_FORMAT` - Log format: `json` or `text` (default: `json`)
- `LOG_OUTPUT_PATH` - Log file path (empty = stdout)

### Using .env Files

1. Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```

2. Update values in `.env` with your actual configuration

3. The `config.Load()` function will automatically load `.env` if it exists

### Validation

The configuration system validates that all required values are set:
- `DB_PASSWORD` must be set
- `JWT_SECRET` must be set
- `REFRESH_SECRET` must be set

If validation fails, `config.Load()` returns an error.

### Helper Methods

#### Database URL
```go
dbURL := cfg.Database.DatabaseURL()
// Returns: postgres://user:pass@host:port/dbname?sslmode=disable
```

#### Environment Checks
```go
if cfg.Server.IsDevelopment() {
    // Development-only code
}

if cfg.Server.IsProduction() {
    // Production-only code
}
```

### Testing

Configuration tests are in `config_test.go`. Run with:

```bash
go test ./internal/config/...
```

### Best Practices

1. **Never commit `.env` files** - They contain sensitive information
2. **Use `.env.example`** - Document all configuration options
3. **Set secrets in production** - Use environment variables or secret management
4. **Validate early** - Configuration is validated on startup
5. **Use defaults wisely** - Defaults should work for local development

### Generating Secrets

For production, generate secure random secrets:

```bash
# Generate JWT secret
openssl rand -hex 32

# Generate refresh secret
openssl rand -hex 32
```

