# Database Migrations

This directory contains database migration files for EarthRing using `golang-migrate`.

## Migration Files

Migrations are numbered sequentially and follow the pattern:
- `{version}_{description}.up.sql` - Migration to apply
- `{version}_{description}.down.sql` - Migration to rollback

### Migration Order

1. `000001_create_postgis_extensions` - Enable PostGIS extensions
2. `000002_create_players_table` - Create players table
3. `000003_create_zones_table` - Create zones table
4. `000004_create_structures_table` - Create structures table
5. `000005_create_chunks_table` - Create chunks table
6. `000006_create_chunk_data_table` - Create chunk_data table
7. `000007_create_roads_table` - Create roads table
8. `000008_create_npc_traffic_table` - Create npc_traffic table
9. `000009_create_npcs_table` - Create npcs table
10. `000010_create_racing_events_table` - Create racing_events table
11. `000011_create_racing_results_table` - Create racing_results table
12. `000012_create_player_actions_table` - Create player_actions table
13. `000013_create_triggers` - Create database triggers

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

## Notes

- Migrations are **idempotent** - running them multiple times is safe (uses `IF NOT EXISTS`)
- Always test migrations on a development database first
- Never edit existing migration files after they've been applied to production
- Create new migrations for schema changes instead of modifying old ones
- The `down` migrations should perfectly reverse the `up` migrations

