# PowerShell script to run database migrations
# Usage: .\database\migrate.ps1 [up|down|version] [steps]

param(
    [Parameter(Mandatory=$true)]
    [ValidateSet("up", "down", "version", "force")]
    [string]$Action,
    
    [Parameter(Mandatory=$false)]
    [int]$Steps = 1,
    
    [Parameter(Mandatory=$false)]
    [string]$DatabaseUrl = $env:DATABASE_URL
)

# Check if DATABASE_URL is set
if (-not $DatabaseUrl) {
    Write-Host "Error: DATABASE_URL environment variable not set." -ForegroundColor Red
    Write-Host "Set it with: `$env:DATABASE_URL = 'postgres://postgres:password@localhost:5432/earthring_dev?sslmode=disable'" -ForegroundColor Yellow
    exit 1
}

# Check if migrate command exists
$migrateCmd = Get-Command migrate -ErrorAction SilentlyContinue
if (-not $migrateCmd) {
    Write-Host "Error: 'migrate' command not found. Install golang-migrate:" -ForegroundColor Red
    Write-Host "  choco install golang-migrate" -ForegroundColor Yellow
    Write-Host "  Or download from: https://github.com/golang-migrate/migrate/releases" -ForegroundColor Yellow
    exit 1
}

$migrationsPath = Join-Path $PSScriptRoot "migrations"

switch ($Action) {
    "up" {
        Write-Host "Applying migrations..." -ForegroundColor Green
        migrate -path $migrationsPath -database $DatabaseUrl up
    }
    "down" {
        Write-Host "Rolling back $Steps migration(s)..." -ForegroundColor Yellow
        migrate -path $migrationsPath -database $DatabaseUrl down $Steps
    }
    "version" {
        Write-Host "Current migration version:" -ForegroundColor Cyan
        migrate -path $migrationsPath -database $DatabaseUrl version
    }
    "force" {
        Write-Host "Forcing migration version to $Steps..." -ForegroundColor Red
        Write-Host "WARNING: This should only be used if migrations are in an inconsistent state!" -ForegroundColor Yellow
        migrate -path $migrationsPath -database $DatabaseUrl force $Steps
    }
}

