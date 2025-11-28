# Pre-commit checks for EarthRing project
# Run this script before committing to ensure code quality

$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "=== PRE-COMMIT CHECKS ===" -ForegroundColor Cyan
Write-Host ""

$exitCode = 0

# 1. Go formatting check
Write-Host "1. Running Go formatting check..." -ForegroundColor Yellow
Push-Location server
$null = go fmt ./...
if ($LASTEXITCODE -eq 0) {
    Write-Host "   [OK] Go formatting OK" -ForegroundColor Green
} else {
    Write-Host "   [FAIL] Go formatting failed" -ForegroundColor Red
    $exitCode = 1
}
Pop-Location

if ($exitCode -ne 0) {
    Write-Host ""
    Write-Host "Pre-commit checks failed. Please fix the issues above." -ForegroundColor Red
    exit $exitCode
}

# 2. Go linter
Write-Host ""
Write-Host "2. Running Go linter..." -ForegroundColor Yellow
Push-Location server
$lintOutput = golangci-lint run --timeout=5m ./... 2>&1
if ($LASTEXITCODE -eq 0) {
    Write-Host "   [OK] Go linting passed" -ForegroundColor Green
} else {
    Write-Host "   [FAIL] Go linting failed" -ForegroundColor Red
    Write-Host $lintOutput
    $exitCode = 1
}
Pop-Location

if ($exitCode -ne 0) {
    Write-Host ""
    Write-Host "Pre-commit checks failed. Please fix the issues above." -ForegroundColor Red
    exit $exitCode
}

# 3. Go tests
Write-Host ""
Write-Host "3. Running Go tests..." -ForegroundColor Yellow
Push-Location server
$testOutput = go test ./... 2>&1
if ($LASTEXITCODE -eq 0) {
    Write-Host "   [OK] Go tests passed" -ForegroundColor Green
} else {
    Write-Host "   [FAIL] Go tests failed" -ForegroundColor Red
    Write-Host $testOutput
    $exitCode = 1
}
Pop-Location

if ($exitCode -ne 0) {
    Write-Host ""
    Write-Host "Pre-commit checks failed. Please fix the issues above." -ForegroundColor Red
    exit $exitCode
}

# 4. Schema verification test
Write-Host ""
Write-Host "4. Running schema verification test..." -ForegroundColor Yellow
Push-Location server
$schemaOutput = go test -v ./internal/database -run TestDatabaseSchemaVerification 2>&1
if ($LASTEXITCODE -eq 0) {
    Write-Host "   [OK] Schema verification passed" -ForegroundColor Green
} else {
    Write-Host "   [FAIL] Schema verification failed" -ForegroundColor Red
    Write-Host $schemaOutput
    $exitCode = 1
}
Pop-Location

if ($exitCode -ne 0) {
    Write-Host ""
    Write-Host "Pre-commit checks failed. Please fix the issues above." -ForegroundColor Red
    exit $exitCode
}

# 5. JavaScript tests
Write-Host ""
Write-Host "5. Running JavaScript tests..." -ForegroundColor Yellow
Push-Location client-web
if (Test-Path "package.json") {
    # Run tests and capture output, suppressing PowerShell error handling for stderr
    $ErrorActionPreference = 'Continue'
    try {
        $jsTestOutput = npm test 2>&1 | Tee-Object -Variable testOutput
        $testExitCode = $LASTEXITCODE
        if ($testExitCode -eq 0) {
            Write-Host "   [OK] JavaScript tests passed" -ForegroundColor Green
        } else {
            Write-Host "   [FAIL] JavaScript tests failed" -ForegroundColor Red
            $testOutput | Select-String -Pattern "FAIL|Error|failed|Test Files|Tests" | Select-Object -First 15
            $exitCode = 1
        }
    } catch {
        # Check if tests actually passed despite stderr noise
        $testSummary = $testOutput | Select-String -Pattern "Test Files|Tests.*passed" | Select-Object -Last 1
        if ($testSummary -match "passed") {
            Write-Host "   [OK] JavaScript tests passed" -ForegroundColor Green
        } else {
            Write-Host "   [FAIL] JavaScript tests failed" -ForegroundColor Red
            $testOutput | Select-String -Pattern "FAIL|Error|failed|Test Files|Tests" | Select-Object -First 15
            $exitCode = 1
        }
    } finally {
        $ErrorActionPreference = 'Stop'
    }
} else {
    Write-Host "   [WARN] client-web directory not found, skipping JavaScript tests" -ForegroundColor Yellow
}
Pop-Location

if ($exitCode -ne 0) {
    Write-Host ""
    Write-Host "Pre-commit checks failed. Please fix the issues above." -ForegroundColor Red
    exit $exitCode
}

# Summary
Write-Host ""
Write-Host "=== PRE-COMMIT CHECKS COMPLETE ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "All checks passed! [OK]" -ForegroundColor Green
Write-Host ""

exit 0
