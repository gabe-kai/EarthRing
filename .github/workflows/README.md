# GitHub Actions Workflows

This directory contains CI/CD workflows for the EarthRing project.

## Workflows

### `ci.yml` - Main CI Workflow
Triggers all other workflows and provides a summary. Runs on pushes and pull requests to `master`/`main`.

### `go.yml` - Go Tests and Lint
- **Tests**: Runs Go unit tests with race detection and coverage
- **Lint**: Runs `golangci-lint` for code quality checks
- **Build**: Builds the server binary and uploads as artifact
- **Database**: Uses PostgreSQL service for integration tests

**Triggers**: Changes to `server/**` or workflow file

### `python.yml` - Python Tests and Lint
- **Tests**: Runs pytest tests on Python 3.11 and 3.12
- **Lint**: Checks code formatting with `black` and linting with `flake8`

**Triggers**: Changes to Python files, tests, or `requirements.txt`

### `javascript.yml` - JavaScript Tests and Build
- **Tests**: Runs Vitest tests
- **Lint**: Runs ESLint (if configured)
- **Build**: Builds the client bundle and uploads as artifact

**Triggers**: Changes to `client-web/**` or workflow file

### `database.yml` - Database Migrations
- **Tests**: Applies all database migrations and verifies schema
- **Database**: Uses PostGIS-enabled PostgreSQL service

**Triggers**: Changes to `database/migrations/**` or workflow file

## Workflow Features

### Caching
- Go modules are cached for faster builds
- Python pip packages are cached
- Node.js npm packages are cached

### Artifacts
- Server binaries are uploaded after successful builds
- Client bundles are uploaded after successful builds
- Artifacts are retained for 7 days

### Database Services
- PostgreSQL services are automatically started for tests
- PostGIS extension is available for spatial tests
- Test databases are created automatically

### Parallel Execution
All workflows run in parallel for faster feedback. The main `ci.yml` workflow provides a summary.

## Environment Variables

Workflows use the following environment variables for testing:

**Go Tests:**
- `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `DB_SSLMODE`
- `JWT_SECRET`, `REFRESH_SECRET` (test values)

**Database Migrations:**
- PostgreSQL connection details are set via service environment

## Manual Triggers

All workflows can be manually triggered via GitHub Actions UI using `workflow_dispatch` event.

## Adding New Workflows

1. Create a new `.yml` file in `.github/workflows/`
2. Follow the existing patterns for consistency
3. Update this README with the new workflow description
4. Consider adding path filters to avoid unnecessary runs

## Troubleshooting

### Workflow Failures
- Check the workflow logs in the Actions tab
- Verify that all required dependencies are listed
- Ensure test databases are properly configured
- Check that environment variables are set correctly

### Slow Workflows
- Ensure caching is properly configured
- Use path filters to skip unnecessary runs
- Consider splitting large workflows into smaller jobs

### Database Connection Issues
- Verify PostgreSQL service is healthy before running tests
- Check that PostGIS extension is installed
- Ensure connection strings match service configuration

