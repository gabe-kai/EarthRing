# PowerShell script to run migrations using psql directly
# This works without golang-migrate installed

param(
    [Parameter(Mandatory=$false)]
    [string]$DatabaseName = "earthring_dev",
    
    [Parameter(Mandatory=$false)]
    [string]$Username = "postgres",
    
    [Parameter(Mandatory=$false)]
    [string]$Password = "Le555ecure",
    
    [Parameter(Mandatory=$false)]
    [string]$DbHost = "localhost",
    
    [Parameter(Mandatory=$false)]
    [int]$DbPort = 5432,
    
    [Parameter(Mandatory=$false)]
    [ValidateSet("up", "down", "check")]
    [string]$Action = "up",
    
    [Parameter(Mandatory=$false)]
    [int]$Steps = 1
)

$ErrorActionPreference = "Stop"

# Set PGPASSWORD environment variable for psql
$env:PGPASSWORD = $Password

$migrationsPath = Join-Path $PSScriptRoot "migrations"

Write-Host ""
Write-Host "=== EarthRing Database Migrations ===" -ForegroundColor Cyan
Write-Host "Database: $DatabaseName" -ForegroundColor Yellow
Write-Host "Host: ${DbHost}:${DbPort}" -ForegroundColor Yellow
Write-Host "Action: $Action" -ForegroundColor Yellow
Write-Host ""

# Check if database exists
Write-Host "Checking database connection..." -ForegroundColor Green
$dbCheck = psql -h $DbHost -p $DbPort -U $Username -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$DatabaseName'" 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "Error: Could not connect to PostgreSQL server" -ForegroundColor Red
    exit 1
}

# Create database if it doesn't exist
if ($dbCheck -notmatch "1") {
    Write-Host "Database '$DatabaseName' does not exist. Creating..." -ForegroundColor Yellow
    psql -h $DbHost -p $DbPort -U $Username -d postgres -c "CREATE DATABASE $DatabaseName;" 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Error: Failed to create database" -ForegroundColor Red
        exit 1
    }
    Write-Host "Database created successfully!" -ForegroundColor Green
}

# Connect to the target database
Write-Host "Connecting to database '$DatabaseName'..." -ForegroundColor Green
$testConn = psql -h $DbHost -p $DbPort -U $Username -d $DatabaseName -c "SELECT 1;" 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "Error: Could not connect to database '$DatabaseName'" -ForegroundColor Red
    Write-Host $testConn
    exit 1
}

if ($Action -eq "check") {
    Write-Host ""
    Write-Host "Checking migration status..." -ForegroundColor Cyan
    $migrationTable = psql -h $DbHost -p $DbPort -U $Username -d $DatabaseName -tAc "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'schema_migrations');" 2>&1
    
    if ($migrationTable -match "t") {
        $currentVersion = psql -h $DbHost -p $DbPort -U $Username -d $DatabaseName -tAc "SELECT version FROM schema_migrations LIMIT 1;" 2>&1
        Write-Host "Current migration version: $currentVersion" -ForegroundColor Green
    } else {
        Write-Host "No migration tracking table found. Migrations not yet run." -ForegroundColor Yellow
    }
    exit 0
}

if ($Action -eq "up") {
    Write-Host ""
    Write-Host "Applying migrations..." -ForegroundColor Cyan
    
    # Get all up migration files in order
    $upMigrations = Get-ChildItem -Path $migrationsPath -Filter "*.up.sql" | Sort-Object Name
    
    foreach ($migration in $upMigrations) {
        $migrationName = $migration.Name
        Write-Host ""
        Write-Host "Running: $migrationName" -ForegroundColor Yellow
        
        # Execute migration file using -f flag
        # Use ErrorActionPreference to continue on NOTICE messages
        $oldErrorAction = $ErrorActionPreference
        $ErrorActionPreference = "Continue"
        
        try {
            $output = psql -h $DbHost -p $DbPort -U $Username -d $DatabaseName -f $migration.FullName 2>&1 | Out-String
            $exitCode = $LASTEXITCODE
            
            # Check for actual errors (not NOTICE messages)
            # NOTICE messages are informational and don't indicate failure
            # Only treat as error if exit code is non-zero AND output contains ERROR (not just NOTICE)
            $hasError = $false
            if ($exitCode -ne 0) {
                # Check if output contains actual ERROR, not just NOTICE
                if ($output -match "ERROR:" -and $output -notmatch "NOTICE:") {
                    $hasError = $true
                } elseif ($output -notmatch "NOTICE:") {
                    # If exit code is non-zero and no NOTICE, it's likely a real error
                    $hasError = $true
                }
                # If exit code is non-zero but only NOTICE messages, it's not an error
            } elseif ($output -match "ERROR:" -and $output -notmatch "NOTICE:") {
                $hasError = $true
            }
            
            if ($hasError) {
                Write-Host "ERROR: Migration failed!" -ForegroundColor Red
                Write-Host $output
                $ErrorActionPreference = $oldErrorAction
                exit 1
            }
            
            Write-Host "Success" -ForegroundColor Green
        } catch {
            # PowerShell may throw on NOTICE, but check if it's actually an error
            $exitCode = $LASTEXITCODE
            # Only fail if exit code is non-zero AND it's not just a NOTICE
            if ($exitCode -ne 0 -and $_.Exception.Message -notmatch "NOTICE:") {
                Write-Host "ERROR: Migration failed!" -ForegroundColor Red
                Write-Host $_.Exception.Message
                $ErrorActionPreference = $oldErrorAction
                exit 1
            }
            Write-Host "Success" -ForegroundColor Green
        } finally {
            $ErrorActionPreference = $oldErrorAction
        }
    }
    
    Write-Host ""
    Write-Host "=== All migrations applied successfully! ===" -ForegroundColor Green
    
    # Show created tables
    Write-Host ""
    Write-Host "Created tables:" -ForegroundColor Cyan
    $tables = psql -h $DbHost -p $DbPort -U $Username -d $DatabaseName -tAc "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;" 2>&1
    if ($tables) {
        $tableArray = $tables -split "`n"
        foreach ($table in $tableArray) {
            $table = $table.Trim()
            if ($table -ne "") {
                Write-Host "  - $table" -ForegroundColor White
            }
        }
    }
}

if ($Action -eq "down") {
    Write-Host ""
    Write-Host "Rolling back migrations..." -ForegroundColor Yellow
    Write-Host "WARNING: Rolling back $Steps migration(s)" -ForegroundColor Red
    
    # Get down migrations in reverse order
    $downMigrations = Get-ChildItem -Path $migrationsPath -Filter "*.down.sql" | Sort-Object Name -Descending
    
    $count = 0
    foreach ($migration in $downMigrations) {
        if ($count -ge $Steps) { break }
        
        $migrationName = $migration.Name
        Write-Host ""
        Write-Host "Rolling back: $migrationName" -ForegroundColor Yellow
        
        $null = psql -h $DbHost -p $DbPort -U $Username -d $DatabaseName -q -f $migration.FullName 2>&1
        
        if ($LASTEXITCODE -ne 0) {
            Write-Host "ERROR: Rollback failed!" -ForegroundColor Red
            # Re-run without -q to show error details
            $errorDetails = psql -h $DbHost -p $DbPort -U $Username -d $DatabaseName -f $migration.FullName 2>&1
            Write-Host $errorDetails
            exit 1
        }
        
        Write-Host "Rolled back" -ForegroundColor Green
        $count++
    }
    
    Write-Host ""
    Write-Host "=== Rollback complete ===" -ForegroundColor Green
}

# Clear password from environment
Remove-Item Env:\PGPASSWORD
