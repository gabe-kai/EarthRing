# EarthRing Deployment Checklist

## Pre-Deployment Validation

Use this checklist before deploying to any environment (staging, production, etc.).

### 1. Code Quality & Tests ✅

- [ ] **All unit tests pass**
  ```bash
  cd server
  go test ./...
  ```

- [ ] **All integration tests pass**
  ```bash
  cd server
  go test -v ./internal/database/...
  ```

- [ ] **Schema verification tests pass**
  ```bash
  cd server
  go test -v ./internal/database/... -run TestDatabaseSchemaVerification
  ```

- [ ] **Critical function tests pass**
  ```bash
  cd server
  go test -v ./internal/database/... -run TestNormalizeForIntersectionFunction
  ```

- [ ] **Client-side tests pass** (if applicable)
  ```bash
  cd client-web
  npm test
  ```

- [ ] **Python tests pass** (if applicable)
  ```bash
  cd server
  pytest
  ```

- [ ] **Linting passes**
  ```bash
  cd server
  golangci-lint run
  ```

### 2. Database Migrations ✅

- [ ] **All migrations are present in `database/migrations/`**
  - Check migration files are numbered sequentially
  - Verify both `.up.sql` and `.down.sql` files exist

- [ ] **Test migrations locally**
  ```powershell
  # Windows
  .\database\run_migrations.ps1 -Action up
  
  # Linux/Mac
  migrate -path database/migrations -database "postgres://..." up
  ```

- [ ] **Verify migrations applied successfully**
  ```sql
  -- Connect to database
  SELECT version FROM schema_migrations;
  ```

- [ ] **Test rollback (optional but recommended)**
  ```powershell
  # Windows
  .\database\run_migrations.ps1 -Action down
  .\database\run_migrations.ps1 -Action up
  ```

- [ ] **Backup production database before migration**
  ```bash
  pg_dump -h localhost -U postgres earthring_prod > backup_$(date +%Y%m%d_%H%M%S).sql
  ```

### 3. Database Schema Verification ✅

- [ ] **All required functions exist**
  - `normalize_for_intersection` (critical for torus overlap)
  - `normalize_zone_geometry_for_area`
  - `update_chunk_versions`
  - `update_zone_timestamp`
  - `mark_chunk_dirty`

- [ ] **All required tables exist**
  - `zones`, `players`, `chunks`, `chunk_data`
  - `structures`, `roads`, `npcs`, `npc_traffic`
  - `racing_events`, `racing_results`, `player_actions`

- [ ] **All required indexes exist**
  - `idx_zones_geometry`
  - `idx_zones_floor`
  - `idx_chunks_x_z_floor`
  - `idx_chunk_data_chunk_id`

- [ ] **All required triggers exist**
  - `zone_updated_at` on `zones`
  - `structure_chunk_dirty` on `structures`

- [ ] **PostGIS extension is installed**
  ```sql
  SELECT extname, extversion FROM pg_extension WHERE extname = 'postgis';
  ```

### 4. Configuration & Environment ✅

- [ ] **Environment variables are set**
  - `DB_HOST`, `DB_PORT`, `DB_NAME`
  - `DB_USER`, `DB_PASSWORD`
  - Any API keys or secrets

- [ ] **Configuration files are updated**
  - Check `server/config/` files
  - Verify environment-specific settings

- [ ] **Connection strings are correct**
  - Test database connection
  - Verify connection pooling settings

### 5. Server Health Checks ✅

- [ ] **Server starts successfully**
  ```bash
  cd server
  go run cmd/earthring-server/main.go
  ```

- [ ] **Server logs show no errors**
  - Check for missing dependencies
  - Verify all services initialize

- [ ] **Health endpoint responds** (if applicable)
  ```bash
  curl http://localhost:8080/health
  ```

- [ ] **WebSocket connections work**
  - Test client connection
  - Verify real-time updates

### 6. Critical Features ✅

- [ ] **Zone creation works**
  - Test rectangle tool
  - Test circle tool
  - Test torus tool (verify hole is preserved!)
  - Test polygon tool
  - Test paintbrush tool

- [ ] **Zone merging works correctly**
  - Test overlapping zones merge
  - Test non-overlapping zones stay separate
  - Test wrapped zones (near X=0)

- [ ] **Torus overlap detection works**
  - Create torus at X=0
  - Create torus at X=5000
  - Verify they DON'T merge (critical test!)

- [ ] **Chunk loading works**
  - Move camera around map
  - Verify chunks load/unload

- [ ] **Player authentication works**
  - Login/logout
  - Session persistence

### 7. Performance & Monitoring ✅

- [ ] **Check query performance**
  ```sql
  -- Enable query logging
  SET log_min_duration_statement = 100;
  
  -- Test slow queries
  EXPLAIN ANALYZE SELECT ... FROM zones ...;
  ```

- [ ] **Verify indexes are being used**
  ```sql
  EXPLAIN ANALYZE SELECT * FROM zones 
  WHERE floor = 0 AND zone_type = 'residential'
  AND ST_Intersects(geometry, ST_MakePoint(1000, 500));
  ```

- [ ] **Monitor memory usage**
  - Server memory footprint
  - Database connection pool

- [ ] **Check error logging**
  - Verify logs are being written
  - Test error handling

### 8. Documentation ✅

- [ ] **CHANGELOG updated**
  - Document new features
  - Note breaking changes
  - List bug fixes

- [ ] **README updated** (if needed)
  - Update version numbers
  - Add new setup instructions

- [ ] **API documentation updated** (if applicable)
  - Document new endpoints
  - Update request/response examples

### 9. Git & Version Control ✅

- [ ] **All changes committed**
  ```bash
  git status
  ```

- [ ] **Commit messages are descriptive**
  - Include issue references
  - Explain what and why

- [ ] **Branch is up to date**
  ```bash
  git pull origin main
  ```

- [ ] **No merge conflicts**

- [ ] **Tag release** (for production)
  ```bash
  git tag -a v1.2.3 -m "Release v1.2.3: Torus overlap detection fix"
  git push origin v1.2.3
  ```

### 10. Post-Deployment Verification ✅

After deployment, verify:

- [ ] **Server is running**
  - Check process status
  - Verify logs show normal startup

- [ ] **Database connections work**
  - Check connection pool
  - Verify no connection errors

- [ ] **Critical features work in production**
  - Test user login
  - Test zone creation
  - Test torus tool specifically

- [ ] **Monitor logs for 15 minutes**
  - Watch for unexpected errors
  - Check error rates

- [ ] **Performance is acceptable**
  - Response times are reasonable
  - No memory leaks
  - CPU usage is normal

## Emergency Rollback Plan

If deployment fails:

### 1. Rollback Code
```bash
git revert <commit-hash>
# or
git reset --hard <previous-commit>
git push origin main --force  # Use with caution!
```

### 2. Rollback Database
```bash
# Restore from backup
psql -h localhost -U postgres earthring_prod < backup_YYYYMMDD_HHMMSS.sql
```

### 3. Rollback Migrations
```powershell
.\database\run_migrations.ps1 -Action down
```

### 4. Verify Rollback
- Run health checks
- Test critical features
- Monitor logs

## Common Issues & Solutions

### Issue: "function normalize_for_intersection does not exist"
**Solution**: Run migration 000016
```bash
psql -d earthring_prod < database/migrations/000016_normalize_for_intersection.up.sql
```

### Issue: "table zones does not exist"
**Solution**: Run all migrations
```powershell
.\database\run_migrations.ps1 -Action up
```

### Issue: Toruses appear as circles
**Solution**: 
1. Check `normalize_for_intersection` function exists
2. Verify client sends 2 rings in GeoJSON
3. Check server logs for geometry structure

### Issue: Non-overlapping zones merge incorrectly
**Solution**:
1. Verify `normalize_for_intersection` is being used in overlap query
2. Check wrap-point handling is correct
3. Test with schema verification tests

## Deployment Environments

### Development
- Database: `earthring_dev`
- Run all checks manually
- Deploy frequently

### Staging
- Database: `earthring_staging`
- Run automated tests via CI/CD
- Test with production-like data
- Deploy before each production release

### Production
- Database: `earthring_prod`
- **ALWAYS backup database first**
- Run full checklist
- Deploy during maintenance window
- Monitor closely for 1 hour post-deployment

## Checklist Summary

Before marking deployment ready:
- ✅ All tests pass (unit + integration + schema verification)
- ✅ Migrations tested and ready
- ✅ Database schema verified
- ✅ Critical features tested
- ✅ Documentation updated
- ✅ Git commits clean and tagged
- ✅ Backup created (for production)

After deployment:
- ✅ Server running normally
- ✅ Critical features work
- ✅ Logs show no errors
- ✅ Performance acceptable

---

**Remember**: It's better to delay deployment than to deploy with known issues!

**Last Updated**: 2025-11-22  
**Version**: 1.0  
**Maintained By**: Development Team

