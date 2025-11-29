# Database Migrations

This directory contains database migration files for EarthRing using `golang-migrate`.

## Migration Files

Migrations are numbered sequentially and follow the pattern:
- `{version}_{description}.up.sql` - Migration to apply
- `{version}_{description}.down.sql` - Migration to rollback

### Migration Order

1. `000001_create_postgis_extensions` - Enable PostGIS extensions
   - Creates: `postgis`, `postgis_topology` extensions
   - **Required by**: All migrations that use geometry types

2. `000002_create_players_table` - Create players table
   - Creates: `players` table

3. `000003_create_zones_table` - Create zones table
   - Creates: `zones` table with `geometry` column
   - Creates: `idx_zones_geometry` (GIST), `idx_zones_floor` indexes
   - **Requires**: Migration 000001 (PostGIS)

4. `000004_create_structures_table` - Create structures table
   - Creates: `structures` table

5. `000005_create_chunks_table` - Create chunks table
   - Creates: `chunks` table
   - Creates: `idx_chunks_x_z_floor` index

6. `000006_create_chunk_data_table` - Create chunk_data table
   - Creates: `chunk_data` table
   - Creates: `idx_chunk_data_chunk_id` index

7. `000007_create_roads_table` - Create roads table
   - Creates: `roads` table

8. `000008_create_npc_traffic_table` - Create npc_traffic table
   - Creates: `npc_traffic` table

9. `000009_create_npcs_table` - Create npcs table
   - Creates: `npcs` table

10. `000010_create_racing_events_table` - Create racing_events table
    - Creates: `racing_events` table

11. `000011_create_racing_results_table` - Create racing_results table
    - Creates: `racing_results` table

12. `000012_create_player_actions_table` - Create player_actions table
    - Creates: `player_actions` table

13. `000013_create_triggers` - Create database triggers
    - Creates: `update_zone_timestamp()` function
    - Creates: `zone_updated_at` trigger on `zones` table
    - Creates: `mark_chunk_dirty()` function
    - Creates: `structure_chunk_dirty` trigger on `structures` table
    - **Requires**: Migrations 000003 (zones), 000004 (structures)

14. `000014_bulk_update_chunk_versions` - Bulk update chunk versions function
    - Creates: `update_chunk_versions()` function
    - **Requires**: Migration 000005 (chunks)

15. `000015_normalize_zone_geometry_for_area` - Normalize zone geometry for area calculation
    - Creates: `normalize_zone_geometry_for_area()` function
    - **Purpose**: Fixes wrap-around bug in area calculation
    - **Used by**: Zone storage for calculating accurate areas of wrapped zones
    - **⚠️ Warning**: Only use for area calculation, not for geometry transformation
    - **Requires**: Migrations 000001 (PostGIS), 000003 (zones)

16. `000016_normalize_for_intersection` - Normalize geometry for intersection detection
    - Creates: `normalize_for_intersection()` function
    - **Purpose**: Fixes torus overlap detection across wrap boundary
    - **Used by**: Zone overlap detection in `CreateZone`
    - **Critical**: Without this, non-overlapping toruses incorrectly merge
    - **Preserves**: Interior rings (holes) in polygons
    - **Requires**: Migration 000001 (PostGIS)

17. `000017_create_default_maglev_zones` - Create default maglev restricted zones
    - Creates: 5 default Restricted zones (one for each floor: -2, -1, 0, 1, 2)
    - **Purpose**: Reserves space for maglev train and loading/unloading equipment on all floors
    - **Zone specifications**:
      - Width: 20m (Y: -10 to +10)
      - Length: Full ring (X: 0 to 264,000,000)
      - Type: Restricted (prevents building)
      - System zone: Yes (protected from player modifications)
    - **Idempotent**: Deletes existing default maglev zones before creating new ones
    - **Requires**: Migration 000003 (zones table)

18. `000023_convert_structures_position_to_geometry` - Convert structures.position to PostGIS geometry
    - Converts: `position POINT` → `position GEOMETRY(POINT, 0)`
    - **Purpose**: Enables use of PostGIS functions (ST_X, ST_Y, ST_MakePoint) for coordinate operations
    - **Data migration**: Converts existing POINT data to GEOMETRY format
    - **Index**: Recreates GIST index on the new geometry column
    - **Requires**: Migration 000004 (structures table), Migration 000001 (PostGIS extension)

## Database Objects Created

### Extensions
- `postgis` - Spatial database functionality
- `postgis_topology` - Topology support

### Tables
| Table | Description | Key Columns | Indexes |
|-------|-------------|-------------|---------|
| `players` | Player accounts | `id`, `username` | - |
| `zones` | Player-created zones | `id`, `geometry`, `floor`, `zone_type` | `idx_zones_geometry` (GIST), `idx_zones_floor` |
| `structures` | Buildings/structures | `id`, `chunk_id` | - |
| `chunks` | World chunks | `x`, `z`, `floor` | `idx_chunks_x_z_floor` |
| `chunk_data` | Chunk geometry data | `chunk_id` | `idx_chunk_data_chunk_id` |
| `roads` | Road network | `id` | - |
| `npc_traffic` | NPC traffic patterns | `id` | - |
| `npcs` | Non-player characters | `id` | - |
| `racing_events` | Racing events | `id` | - |
| `racing_results` | Racing results | `id` | - |
| `player_actions` | Player action log | `id`, `player_id` | - |

### Functions
| Function | Purpose | Used By | Critical? |
|----------|---------|---------|-----------|
| `update_zone_timestamp()` | Updates `updated_at` on zones | Trigger | No |
| `mark_chunk_dirty()` | Marks chunks for regeneration | Trigger | No |
| `update_chunk_versions()` | Bulk updates chunk versions | Maintenance | No |
| `normalize_zone_geometry_for_area()` | Normalizes wrapped zones for area calc | Zone storage | Yes |
| `normalize_for_intersection()` | Normalizes wrapped zones for overlap detection | Zone creation | **CRITICAL** |

### Triggers
| Trigger | Table | Function | Purpose |
|---------|-------|----------|---------|
| `zone_updated_at` | `zones` | `update_zone_timestamp()` | Auto-update timestamp |
| `structure_chunk_dirty` | `structures` | `mark_chunk_dirty()` | Mark chunks for regen |

## Migration Dependencies

```
000001 (PostGIS) ──┬─→ 000003 (zones) ──┬─→ 000013 (triggers)
                   │                      └─→ 000015 (normalize_area)
                   └─→ 000016 (normalize_intersection)

000004 (structures) ─→ 000013 (triggers)
000005 (chunks) ─→ 000014 (bulk_update)
```

**Critical Path**:
1. PostGIS must be installed first
2. Tables must exist before triggers
3. `normalize_for_intersection` is independent but required for production

## Installation

### Install golang-migrate

**Windows (PowerShell):**
```powershell
# Using Chocolatey
choco install golang-migrate

# Or download from: https://github.com/golang-migrate/migrate/releases
```

**Linux/Mac:**
```bash
# Using Homebrew (Mac)
brew install golang-migrate

# Or download from: https://github.com/golang-migrate/migrate/releases
```

## Usage

### Database Connection String Format

PostgreSQL connection string format:
```
postgres://username:password@host:port/database?sslmode=disable
```

Example:
```
postgres://postgres:password@localhost:5432/earthring_dev?sslmode=disable
```

### Running Migrations

**Apply all pending migrations:**
```bash
migrate -path database/migrations -database "postgres://postgres:password@localhost:5432/earthring_dev?sslmode=disable" up
```

**Rollback last migration:**
```bash
migrate -path database/migrations -database "postgres://postgres:password@localhost:5432/earthring_dev?sslmode=disable" down 1
```

**Check migration version:**
```bash
migrate -path database/migrations -database "postgres://postgres:password@localhost:5432/earthring_dev?sslmode=disable" version
```

**Force migration version (use with caution):**
```bash
migrate -path database/migrations -database "postgres://postgres:password@localhost:5432/earthring_dev?sslmode=disable" force {version}
```

### Environment Variables

You can use environment variables for the database connection:

```bash
export DATABASE_URL="postgres://postgres:password@localhost:5432/earthring_dev?sslmode=disable"
migrate -path database/migrations -database $DATABASE_URL up
```

## Migration Workflow

1. **Create new migration:**
   ```bash
   migrate create -ext sql -dir database/migrations -seq {description}
   ```

2. **Edit the generated `.up.sql` and `.down.sql` files**

3. **Test migration:**
   ```bash
   # Apply migration
   migrate -path database/migrations -database $DATABASE_URL up
   
   # Verify tables/structures created
   psql -U postgres -d earthring_dev -c "\dt"
   
   # Rollback to test down migration
   migrate -path database/migrations -database $DATABASE_URL down 1
   ```

4. **Commit migration files to git**

## Alternative: PowerShell Migration Script

If you don't have `golang-migrate` installed, you can use the PowerShell script:

**Windows PowerShell:**
```powershell
# Apply all migrations
.\database\run_migrations.ps1 -Action up

# Check migration status
.\database\run_migrations.ps1 -Action check

# Rollback last migration
.\database\run_migrations.ps1 -Action down -Steps 1
```

The script will:
- Automatically create the database if it doesn't exist
- Apply all migrations in order
- Handle NOTICE messages gracefully
- Show created tables after successful migration

**Configuration**: Edit `database/run_migrations.ps1` to change database connection settings (default: `postgres@localhost:5432/earthring_dev`).

## Verifying Migrations

After running migrations, verify they were applied correctly:

### 1. Check Migration Version
```bash
migrate -path database/migrations -database $DATABASE_URL version
```

### 2. Verify Tables Exist
```sql
SELECT tablename FROM pg_tables 
WHERE schemaname = 'public' 
ORDER BY tablename;
```

Expected tables: `chunks`, `chunk_data`, `npcs`, `npc_traffic`, `player_actions`, `players`, `racing_events`, `racing_results`, `roads`, `structures`, `zones`

### 3. Verify Functions Exist
```sql
SELECT proname FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public'
ORDER BY proname;
```

Expected functions:
- `mark_chunk_dirty`
- `normalize_for_intersection` ⚠️ **CRITICAL**
- `normalize_zone_geometry_for_area`
- `update_chunk_versions`
- `update_zone_timestamp`

### 4. Verify Triggers Exist
```sql
SELECT trigger_name, event_object_table 
FROM information_schema.triggers 
WHERE trigger_schema = 'public'
ORDER BY trigger_name;
```

Expected triggers:
- `structure_chunk_dirty` on `structures`
- `zone_updated_at` on `zones`

### 5. Run Schema Verification Tests
```bash
cd server
go test -v ./internal/database/... -run TestDatabaseSchemaVerification
```

This test will verify ALL required database objects exist.

### 6. Test Critical Functions
```bash
cd server
go test -v ./internal/database/... -run TestNormalizeForIntersectionFunction
```

This specifically tests the `normalize_for_intersection` function.

## Troubleshooting

### Migration fails with "relation already exists"
This means the object was created manually or by a previous migration attempt.

**Solution**:
1. Drop the conflicting object (if safe)
2. Force the migration version:
   ```bash
   migrate -path database/migrations -database $DATABASE_URL force {version}
   ```
3. Continue with next migration

### Function "normalize_for_intersection" does not exist
This is a **critical error** that will cause torus overlap detection to fail.

**Solution**:
```bash
# Apply migration 000016
psql -d earthring_dev < database/migrations/000016_normalize_for_intersection.up.sql

# Or use the quick-fix SQL file
psql -d earthring_dev < fix_torus_overlap_detection.sql
```

### Trigger already exists
Migrations 000013 may fail if triggers already exist.

**Solution**: Migration files should use `CREATE OR REPLACE FUNCTION` and check for existing triggers before creating them.

### PostGIS extension not found
**Solution**: Install PostGIS first:
```bash
# Ubuntu/Debian
sudo apt-get install postgresql-postgis

# Mac
brew install postgis

# Windows
# Install from https://postgis.net/windows_downloads/
```

## Best Practices

### When Creating New Migrations

1. **Create migration files**:
   ```bash
   migrate create -ext sql -dir database/migrations -seq your_description
   ```

2. **Write idempotent SQL**: Use `IF NOT EXISTS`, `CREATE OR REPLACE`
   ```sql
   CREATE TABLE IF NOT EXISTS my_table (...);
   CREATE OR REPLACE FUNCTION my_function() ...;
   ```

3. **Document dependencies**: Add comments explaining what the migration requires
   ```sql
   -- REQUIRES: 000001_create_postgis_extensions (for geometry types)
   -- CREATES: my_table (used by feature X)
   ```

4. **Test both up and down**:
   ```bash
   migrate up
   # Verify it worked
   migrate down 1
   # Verify rollback worked
   migrate up
   ```

5. **Update this README**: Add your migration to the list above with description and dependencies

6. **Create schema verification test**: Add required objects to `TestDatabaseSchemaVerification`

### When Deploying to Production

1. **Backup database first**:
   ```bash
   pg_dump -h localhost -U postgres earthring_prod > backup_$(date +%Y%m%d).sql
   ```

2. **Run migrations in a transaction** (if possible):
   ```sql
   BEGIN;
   -- Run migrations
   COMMIT;
   -- Or ROLLBACK if something fails
   ```

3. **Verify after deployment**:
   - Check migration version
   - Run schema verification tests
   - Test critical features

4. **Monitor logs** for 15 minutes after deployment

## Notes

- Migrations are **idempotent** - running them multiple times is safe (uses `IF NOT EXISTS`)
- Always test migrations on a development database first
- Never edit existing migration files after they've been applied to production
- Create new migrations for schema changes instead of modifying old ones
- The `down` migrations should perfectly reverse the `up` migrations
- **Schema verification tests** bridge the gap between test and production databases

