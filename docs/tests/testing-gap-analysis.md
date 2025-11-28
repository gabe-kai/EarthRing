# Testing Gap Analysis: Database Schema Verification

## The Problem You Identified

When we deployed the torus overlap detection fix, the server failed with:

```
pq: function normalize_for_intersection(geometry) does not exist
```

**Yet all tests passed! ✅**

This exposed a critical gap in our testing strategy.

## Why Tests Passed Without the Function

Our test suite uses **test isolation** - each test creates its own database objects:

```go
func createNormalizeFunction(t *testing.T, db *sql.DB) {
    // Creates normalize_for_intersection
    // Creates normalize_zone_geometry_for_area
    // ... etc
}
```

**Trade-off:**
- ✅ **Good**: Tests are isolated, repeatable, fast
- ❌ **Bad**: Tests don't verify production database state

## The Gap: Missing Schema Verification

We had **5 database functions** but **zero tests** verifying they exist in production:

1. `normalize_for_intersection` - ⚠️ NEW, caused production failure
2. `normalize_zone_geometry_for_area` - Used in area calculations
3. `update_chunk_versions` - Bulk chunk updates
4. `update_zone_timestamp` - Zone update trigger
5. `mark_chunk_dirty` - Chunk dirty marking trigger

## The Solution: Schema Verification Tests

Created `server/internal/database/schema_verification_test.go` with:

### 1. `TestDatabaseSchemaVerification`
Comprehensive verification of:
- ✅ All required functions exist
- ✅ All required tables exist  
- ✅ All required triggers exist
- ✅ All required indexes exist
- ✅ PostGIS extension is installed

**This test simulates production** - it checks what *should* exist after migrations.

### 2. `TestNormalizeForIntersectionFunction`
Specifically tests the function that caused the production failure:
- ✅ Function exists
- ✅ Handles non-wrapped geometries correctly
- ✅ Normalizes wrapped geometries correctly
- ✅ Preserves holes in toruses

**Test output:**
```
✓ Non-wrapped geometry: POLYGON((0 0,10 0,10 10,0 10,0 0))
✓ Wrapped geometry normalized: POLYGON((-10 0,10 0,10 10,-10 10,-10 0))
✓ Torus hole preserved: 1 interior rings
```

## Testing Strategy: Two-Tier Approach

### Tier 1: Unit Tests (Existing)
**Purpose**: Test business logic in isolation
**Setup**: Creates all dependencies (tables, functions, etc.)
**Example**: `TestZoneStorage_TorusHasHole`

```go
func TestZoneStorage_TorusHasHole(t *testing.T) {
    db := testutil.SetupTestDB(t)
    createZonesTable(t, db)           // ← Creates dependencies
    createNormalizeFunction(t, db)    // ← Creates dependencies
    // ... test business logic
}
```

**Pros**: Fast, isolated, reliable
**Cons**: Doesn't verify production schema

### Tier 2: Schema Verification Tests (NEW)
**Purpose**: Verify production database state
**Setup**: Assumes migrations have been run
**Example**: `TestDatabaseSchemaVerification`

```go
func TestDatabaseSchemaVerification(t *testing.T) {
    db := testutil.SetupTestDB(t)
    // Does NOT create objects - verifies they exist
    var exists bool
    db.QueryRow("SELECT EXISTS(...normalize_for_intersection...)").Scan(&exists)
    if !exists {
        t.Error("Function missing! Run migrations.")
    }
}
```

**Pros**: Catches missing migrations, verifies production state
**Cons**: Requires migrations to be run first

## How This Prevents Future Issues

### Before (The Problem)
1. Developer adds new database function
2. Updates test helper to create the function
3. Tests pass ✅
4. Deploys to production
5. **Production fails** - function doesn't exist ❌
6. Developer realizes they forgot to create migration

### After (The Solution)
1. Developer adds new database function
2. Updates test helper to create the function
3. Tests pass ✅
4. **Schema verification test fails** ❌
   ```
   ❌ Required function new_function_name does not exist. Run migrations to create it.
   ```
5. Developer creates migration
6. Runs migration
7. Schema verification test passes ✅
8. Deploys to production
9. **Production works** ✅

## Running Schema Verification Tests

### Local Development
```bash
cd server
go test -v ./internal/database/... -run TestDatabaseSchemaVerification
```

### CI/CD Pipeline
Add to your CI configuration:
```yaml
- name: Verify Database Schema
  run: |
    # Run migrations
    ./database/run_migrations.ps1 -Action up
    # Verify schema
    cd server
    go test -v ./internal/database/... -run TestDatabaseSchemaVerification
```

## Other Potential Gaps

Based on this analysis, we should add schema verification for:

1. **Database Extensions**
   - ✅ PostGIS (already verified)
   - Consider: UUID, pg_trgm, etc.

2. **Constraints**
   - Foreign keys
   - Check constraints
   - Unique constraints

3. **Views** (if we add them)
   - Materialized views
   - Regular views

4. **Permissions**
   - User roles
   - Table permissions
   - Function execution permissions

5. **Configuration**
   - PostgreSQL version
   - PostGIS version
   - Required extensions

## Recommendations

### 1. Update CI/CD Pipeline
Add schema verification as a required check before deployment.

### 2. Pre-Deployment Checklist
Create a checklist:
- [ ] Run all unit tests
- [ ] Run schema verification tests
- [ ] Verify migrations applied correctly
- [ ] Check server logs for missing dependencies

### 3. Migration Documentation
Update `database/migrations/README.md` to document:
- Which migrations create which functions
- Dependencies between migrations
- How to verify migrations were applied

### 4. Developer Workflow
Add to development guidelines:
1. When adding a database object, create migration **first**
2. Run migration locally
3. Update test helpers to match
4. Run both unit tests AND schema verification tests

## Key Takeaway

**Test isolation is great for unit tests, but you also need integration tests that verify your actual deployment artifacts (migrations, schema, etc.).**

The new schema verification tests bridge this gap, ensuring that what works in tests will also work in production.

## Files Added/Modified

### New Files
- `server/internal/database/schema_verification_test.go` - Schema verification tests
- `TESTING_GAP_ANALYSIS.md` - This document

### Modified Files
- `server/internal/database/zones_test.go` - Now creates both normalization functions
- `database/migrations/000016_normalize_for_intersection.up.sql` - New function migration

## Related Issues

- Original issue: Torus overlap detection bug
- Related fix: `TORUS_FIX_SUMMARY.md`
- Wrap-point fixes: `WRAP_POINT_FIX_SUMMARY.md`

## Future Improvements

1. **Automated Schema Comparison**
   - Compare test DB schema with production schema
   - Alert on differences

2. **Migration Validation**
   - Verify all migrations can be applied cleanly
   - Test rollback functionality

3. **Performance Benchmarks**
   - Test function performance with large geometries
   - Ensure indexes are being used

4. **Data Integrity Tests**
   - Verify constraints prevent invalid data
   - Test trigger behavior

