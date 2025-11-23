# EarthRing Developer Workflow

## Table of Contents
- [Initial Setup](#initial-setup)
- [Daily Development Workflow](#daily-development-workflow)
- [Adding Database Changes](#adding-database-changes)
- [Testing Strategy](#testing-strategy)
- [Code Review Checklist](#code-review-checklist)
- [Common Tasks](#common-tasks)
- [Troubleshooting](#troubleshooting)

## Initial Setup

### 1. Clone Repository
```bash
git clone https://github.com/your-org/earthring.git
cd earthring
```

### 2. Set Up Database
```powershell
# Windows PowerShell
.\database\run_migrations.ps1 -Action up

# Verify migrations
cd server
go test -v ./internal/database/... -run TestDatabaseSchemaVerification
```

### 3. Install Dependencies
```bash
# Server (Go)
cd server
go mod download

# Client (JavaScript)
cd ../client-web
npm install

# Python service (if needed)
cd ../server
pip install -r requirements.txt
```

### 4. Configure Environment
```bash
# Copy example .env file
cp .env.example .env

# Edit .env with your settings
# DB_HOST=localhost
# DB_PORT=5432
# DB_NAME=earthring_dev
# DB_USER=postgres
# DB_PASSWORD=Le555ecure
```

### 5. Verify Installation
```bash
# Run all tests
cd server
go test ./...

# Run schema verification
go test -v ./internal/database/... -run TestDatabaseSchemaVerification

# Start server
go run cmd/earthring-server/main.go
```

## Daily Development Workflow

### Starting Your Day

1. **Pull latest changes**
   ```bash
   git checkout main
   git pull origin main
   ```

2. **Update dependencies** (if needed)
   ```bash
   cd server
   go mod tidy
   
   cd ../client-web
   npm install
   ```

3. **Run migrations** (if new ones exist)
   ```powershell
   .\database\run_migrations.ps1 -Action up
   ```

4. **Run tests** to ensure everything works
   ```bash
   cd server
   go test ./...
   ```

### Working on a Feature

1. **Create feature branch**
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Make changes** following code standards

3. **Run tests frequently**
   ```bash
   # Quick test - just the package you're working on
   go test ./internal/database/
   
   # Full test suite
   go test ./...
   ```

4. **Commit changes with descriptive messages**
   ```bash
   git add .
   git commit -m "Add feature: description of what you did
   
   - Detail 1
   - Detail 2
   - Fixes #123"
   ```

5. **Push and create PR**
   ```bash
   git push origin feature/your-feature-name
   ```

### Ending Your Day

1. **Commit work-in-progress** (if needed)
   ```bash
   git add .
   git commit -m "WIP: Feature X - checkpoint"
   git push origin feature/your-feature-name
   ```

2. **Document blockers** in PR or task tracker

## Adding Database Changes

**CRITICAL**: Always create migrations BEFORE updating test helpers!

### Workflow for Database Changes

#### 1. Create Migration First
```bash
# Create migration files
cd database/migrations
migrate create -ext sql -dir . -seq add_my_feature

# This creates:
# - 000017_add_my_feature.up.sql
# - 000017_add_my_feature.down.sql
```

#### 2. Write Migration SQL
```sql
-- 000017_add_my_feature.up.sql

-- REQUIRES: 000001_create_postgis_extensions
-- CREATES: my_new_table

CREATE TABLE IF NOT EXISTS my_new_table (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_my_new_table_name ON my_new_table(name);
```

```sql
-- 000017_add_my_feature.down.sql

DROP INDEX IF EXISTS idx_my_new_table_name;
DROP TABLE IF EXISTS my_new_table;
```

#### 3. Test Migration Locally
```powershell
# Apply migration
.\database\run_migrations.ps1 -Action up

# Verify it worked
psql -d earthring_dev -c "\dt my_new_table"

# Test rollback
.\database\run_migrations.ps1 -Action down -Steps 1

# Verify rollback worked
psql -d earthring_dev -c "\dt my_new_table"  # Should not exist

# Re-apply
.\database\run_migrations.ps1 -Action up
```

#### 4. Update Test Helpers
```go
// server/internal/database/my_test.go

func createMyNewTable(t *testing.T, db *sql.DB) {
    t.Helper()
    _, err := db.Exec(`
        CREATE TABLE IF NOT EXISTS my_new_table (
            id SERIAL PRIMARY KEY,
            name VARCHAR(255) NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `)
    if err != nil {
        t.Fatalf("failed to create my_new_table: %v", err)
    }
}
```

#### 5. Update Schema Verification Test
```go
// server/internal/database/schema_verification_test.go

func TestDatabaseSchemaVerification(t *testing.T) {
    // ...
    t.Run("RequiredTables", func(t *testing.T) {
        requiredTables := []string{
            "zones",
            "players",
            // ... existing tables ...
            "my_new_table",  // ← Add your table
        }
        // ...
    })
}
```

#### 6. Add Database Function (if needed)
```sql
-- 000017_add_my_function.up.sql

CREATE OR REPLACE FUNCTION my_function(param GEOMETRY)
RETURNS GEOMETRY AS $$
BEGIN
    -- Function logic
    RETURN param;
END;
$$ LANGUAGE plpgsql IMMUTABLE STRICT;
```

Then update `createNormalizeFunction()` in test helper AND `TestDatabaseSchemaVerification`:

```go
// Test helper
func createNormalizeFunction(t *testing.T, db *sql.DB) {
    // ... existing functions ...
    
    // Add your function
    _, err := db.Exec(`CREATE OR REPLACE FUNCTION my_function(...)...`)
    if err != nil {
        t.Fatalf("failed to create my_function: %v", err)
    }
}

// Schema verification
func TestDatabaseSchemaVerification(t *testing.T) {
    t.Run("RequiredFunctions", func(t *testing.T) {
        requiredFunctions := []string{
            "normalize_for_intersection",
            // ... existing functions ...
            "my_function",  // ← Add your function
        }
        // ...
    })
}
```

#### 7. Run Full Test Suite
```bash
cd server

# Run all tests
go test ./...

# Run schema verification specifically
go test -v ./internal/database/... -run TestDatabaseSchemaVerification

# This should FAIL if migration wasn't applied
# This should PASS after migration is applied
```

#### 8. Update Documentation
```markdown
# database/migrations/README.md

17. `000017_add_my_feature` - Add my new feature
    - Creates: `my_new_table` table
    - Creates: `idx_my_new_table_name` index
    - **Requires**: Migration 000001 (if using geometry)
    - **Used by**: Feature X
```

### Why This Order Matters

**WRONG** (old way):
1. Update test helper to create object ❌
2. Tests pass ✅
3. Deploy to production 
4. Production fails ❌ (object doesn't exist)
5. Create migration
6. Deploy again

**RIGHT** (new way):
1. Create migration ✅
2. Apply migration locally ✅
3. Update test helper ✅
4. Update schema verification test ✅
5. Tests pass ✅
6. Schema verification **FAILS** if migration not applied ⚠️
7. Deploy to production
8. Production works ✅

## Testing Strategy

### Two-Tier Testing Approach

#### Tier 1: Unit Tests (Business Logic)
```bash
# Run specific test
go test -v ./internal/database/... -run TestZoneStorage_TorusHasHole

# Run all zone tests
go test -v ./internal/database/... -run TestZoneStorage
```

**Purpose**: Test business logic in isolation  
**Creates**: All dependencies (tables, functions)  
**Fast**: Yes  
**Verifies Production**: No

#### Tier 2: Schema Verification (Production Readiness)
```bash
# Verify all database objects exist
go test -v ./internal/database/... -run TestDatabaseSchemaVerification

# Verify critical functions work
go test -v ./internal/database/... -run TestNormalizeForIntersectionFunction
```

**Purpose**: Verify migrations were applied  
**Creates**: Nothing (checks what exists)  
**Fast**: Yes  
**Verifies Production**: Yes ✅

### Test Before Committing
```bash
# Run this command before every commit
cd server

# Full test suite
go test ./...

# Schema verification
go test -v ./internal/database/... -run TestDatabaseSchemaVerification

# If schema verification fails, you forgot to apply migration!
```

### Test Categories

1. **Unit Tests** - Test individual functions
2. **Integration Tests** - Test database interactions
3. **Schema Verification** - Test production readiness
4. **E2E Tests** - Test full user flows (future)

## Code Review Checklist

### For Reviewers

- [ ] Code follows Go/JavaScript style guidelines
- [ ] Tests are included and pass
- [ ] Schema verification tests updated (if database changed)
- [ ] Migration files created (if database changed)
- [ ] Documentation updated
- [ ] No hardcoded secrets or passwords
- [ ] Error handling is appropriate
- [ ] Logging is helpful but not excessive

### For Authors

Before requesting review:

- [ ] All tests pass locally
- [ ] Schema verification tests pass
- [ ] Code is formatted (`go fmt`, `prettier`)
- [ ] Commit messages are descriptive
- [ ] PR description explains what and why
- [ ] Related issue is referenced
- [ ] Database changes have migrations
- [ ] Documentation is updated

## Common Tasks

### Task 1: Add New Zone Tool

1. **Update client** (`client-web/src/zones/zone-editor.js`):
   ```javascript
   createMyToolGeometry(start, end) {
       // Generate GeoJSON
       return {
           type: 'Polygon',
           coordinates: [/* ... */]
       };
   }
   ```

2. **Add tests** (`client-web/src/zones/__tests__/`):
   ```javascript
   test('My tool creates valid geometry', () => {
       // Test your tool
   });
   ```

3. **Test manually**:
   - Start server
   - Open client
   - Test tool at X=0 (wrap boundary)
   - Test tool at X=5000 (normal)
   - Test overlapping zones

4. **Update documentation** (`docs/06-client-architecture.md`)

### Task 2: Add New Database Function

Follow [Adding Database Changes](#adding-database-changes) workflow.

**Key points**:
1. Create migration FIRST
2. Test migration locally
3. Update test helper
4. Update schema verification test
5. Run full test suite

### Task 3: Fix Wrap-Point Bug

1. **Identify the problem**:
   - Does it affect coordinates?
   - Does it affect geometry?
   - Does it affect overlap detection?

2. **Check existing helpers**:
   - `wrapRingPosition()` (client)
   - `WrapPosition()` (server)
   - `normalize_for_intersection()` (database)
   - `normalizeRelativeToCamera()` (client)

3. **Add test case** that reproduces the bug

4. **Fix the bug** using existing patterns

5. **Verify fix** with tests

6. **Document** in WRAP_POINT_FIX_SUMMARY.md (if significant)

### Task 4: Optimize Database Query

1. **Identify slow query** using logs or profiling

2. **Explain the query**:
   ```sql
   EXPLAIN ANALYZE 
   SELECT * FROM zones 
   WHERE ST_Intersects(geometry, ST_MakePoint(1000, 500));
   ```

3. **Check if indexes are used**:
   - GIST indexes for spatial queries
   - B-tree indexes for equality/range

4. **Add index if needed** (via migration)

5. **Test performance improvement**

## Troubleshooting

### "function does not exist" in production

**Cause**: Migration wasn't applied  
**Solution**:
```bash
# Check migration version
psql -d earthring_prod -c "SELECT version FROM schema_migrations;"

# Apply missing migrations
.\database\run_migrations.ps1 -Action up
```

### Tests pass but production fails

**Cause**: Schema verification tests not run  
**Solution**:
```bash
# Always run schema verification before deployment
go test -v ./internal/database/... -run TestDatabaseSchemaVerification
```

### Torii appear as circles

**Cause**: Hole is lost in geometry processing  
**Solution**:
1. Check `normalize_for_intersection` exists
2. Verify GeoJSON has 2 rings
3. Check server logs for geometry structure

### Non-overlapping zones merge

**Cause**: Wrap-point handling in overlap detection  
**Solution**:
1. Verify `normalize_for_intersection` is used in overlap query
2. Test with zones near X=0
3. Check coordinate normalization

### Migration fails with "already exists"

**Cause**: Object created manually or duplicate migration  
**Solution**:
```bash
# Force migration version
migrate -database $DATABASE_URL force {version}

# Or drop object and re-run
psql -d earthring_dev -c "DROP TABLE IF EXISTS table_name;"
```

## Git Workflow

### Branch Naming
- `feature/description` - New features
- `fix/description` - Bug fixes
- `docs/description` - Documentation
- `refactor/description` - Code refactoring

### Commit Messages
```
Short summary (50 chars or less)

More detailed explanation if needed. Wrap at 72 characters.
Explain the problem this solves and why you chose this approach.

- Bullet points for multiple changes
- Keep it clear and concise

Fixes #123
Relates to #456
```

### Pull Request Template
```markdown
## Description
Brief description of changes

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Breaking change
- [ ] Documentation update

## Testing
- [ ] Unit tests pass
- [ ] Integration tests pass
- [ ] Schema verification tests pass
- [ ] Manually tested

## Database Changes
- [ ] Migration created
- [ ] Migration tested (up and down)
- [ ] Schema verification updated

## Documentation
- [ ] README updated
- [ ] Inline comments added
- [ ] API docs updated (if applicable)

## Checklist
- [ ] Code follows style guidelines
- [ ] Self-review completed
- [ ] Tests added/updated
- [ ] No new warnings
```

## Best Practices

### Code Style
- Follow Go conventions (gofmt, golint)
- Use meaningful variable names
- Keep functions small and focused
- Comment complex logic

### Testing
- Write tests first (TDD when appropriate)
- Test edge cases (especially wrap-point!)
- Use descriptive test names
- Keep tests fast

### Database
- Always use migrations
- Never modify existing migrations in production
- Test both up and down migrations
- Document dependencies

### Documentation
- Update docs with code changes
- Include examples
- Explain the "why", not just the "what"
- Keep it up to date

## Resources

- [Project README](README.md)
- [Database Migrations](database/migrations/README.md)
- [Deployment Checklist](DEPLOYMENT_CHECKLIST.md)
- [Testing Gap Analysis](TESTING_GAP_ANALYSIS.md)
- [Torus Fix Summary](TORUS_FIX_SUMMARY.md)
- [Wrap-Point Fix Summary](WRAP_POINT_FIX_SUMMARY.md)

---

**Questions?** Ask in the team chat or open an issue!

**Last Updated**: 2025-11-22  
**Maintained By**: Development Team

