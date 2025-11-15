# Run the procedural generation service (PowerShell)

$ErrorActionPreference = "Stop"

# Change to server directory
Set-Location "$PSScriptRoot\.."

# Activate virtual environment if it exists
if (Test-Path "venv\Scripts\Activate.ps1") {
    & "venv\Scripts\Activate.ps1"
}

# Get environment variables or use defaults
$host = if ($env:PROCEDURAL_SERVICE_HOST) { $env:PROCEDURAL_SERVICE_HOST } else { "0.0.0.0" }
$port = if ($env:PROCEDURAL_SERVICE_PORT) { $env:PROCEDURAL_SERVICE_PORT } else { "8081" }

# Run the service
python -m uvicorn internal.procedural.main:app `
    --host $host `
    --port $port `
    --reload

