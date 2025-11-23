# Database Scripts

This directory contains quick-fix SQL scripts for common database issues.

## Scripts

### `verify_and_fix_normalize_for_intersection.sql`

**Purpose**: Verifies and fixes the `normalize_for_intersection` function, which is critical for zone overlap detection.

**When to use**:
- Zone merging is not working correctly
- You see errors about `normalize_for_intersection` not existing
- Zones that should merge are not merging

**What it does**:
1. Checks if the function exists
2. Creates or updates the function with the latest version
3. Tests the function with multiple scenarios
4. Displays function information for verification

**How to run**:
```bash
# Using psql
psql -d earthring_dev < database/scripts/verify_and_fix_normalize_for_intersection.sql

# Or connect to your database and run the SQL directly
psql -d earthring_dev
\i database/scripts/verify_and_fix_normalize_for_intersection.sql
```

**Expected output**:
```
NOTICE:  ✓ normalize_for_intersection function exists
NOTICE:  ✓ Test 1 passed: Non-wrapped geometry handled correctly
NOTICE:  ✓ Test 2 passed: Wrapped geometry normalized correctly
NOTICE:  ✓ Test 3 passed: Torus hole preserved (1 interior rings)
NOTICE:  ✓ Test 4 passed: Simple rectangle handled correctly (no NULL return)
NOTICE:  
NOTICE:  ✅ All tests passed! normalize_for_intersection function is working correctly.
NOTICE:     Zone overlap detection should now work properly.
```

### `fix_torus_overlap_detection.sql`

**Purpose**: Legacy script for fixing torus overlap detection. Superseded by migration 000016 and the verify script above.

**Note**: Use `verify_and_fix_normalize_for_intersection.sql` instead, as it includes the latest fixes and verification.

## Important Notes

- **Always backup your database** before running scripts
- These scripts are **idempotent** - safe to run multiple times
- Scripts use `CREATE OR REPLACE FUNCTION` so they won't fail if the function already exists
- If a script fails, check the error message and ensure you have the required permissions

## Troubleshooting

### "permission denied" error
- Ensure you're connected as a user with CREATE FUNCTION privileges
- Usually the database owner or a superuser

### "function does not exist" after running script
- Check that you're connected to the correct database
- Verify the script completed without errors
- Check PostgreSQL logs for detailed error messages

### Zone merging still not working after running script
- Check server logs for overlap detection errors
- Verify zones have matching `zone_type`, `floor`, `owner_id`, and `is_system_zone`
- Ensure zones actually overlap (not just touching at edges)
- Check that `ST_Intersects` is working correctly with your geometries
