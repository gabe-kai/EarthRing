# EarthRing Development Environment Setup Script (PowerShell)

Write-Host "Setting up EarthRing development environment..." -ForegroundColor Green

# Check prerequisites
Write-Host "Checking prerequisites..." -ForegroundColor Yellow
$prereqs = @{
    "go" = "Go"
    "python" = "Python 3"
    "node" = "Node.js"
    "psql" = "PostgreSQL"
}

foreach ($cmd in $prereqs.Keys) {
    if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
        Write-Host "ERROR: $($prereqs[$cmd]) is required but not installed." -ForegroundColor Red
        exit 1
    }
}

Write-Host "✓ All prerequisites found" -ForegroundColor Green

# Install Go dependencies
Write-Host "Installing Go dependencies..." -ForegroundColor Yellow
Set-Location server
go mod download
go mod tidy
Set-Location ..

# Install Python dependencies
Write-Host "Installing Python dependencies..." -ForegroundColor Yellow
Set-Location server
python -m pip install -r requirements.txt
Set-Location ..

# Install Node.js dependencies
Write-Host "Installing Node.js dependencies..." -ForegroundColor Yellow
Set-Location client-web
npm install
Set-Location ..

Write-Host "✓ Development environment setup complete!" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "1. Set up PostgreSQL database (see database/schema/init.sql)"
Write-Host "2. Configure environment variables"
Write-Host "3. Run 'go test ./...' to verify Go tests"
Write-Host "4. Run 'pytest' to verify Python tests"
Write-Host "5. Run 'npm test' in client-web to verify JavaScript tests"

