#!/bin/bash
# EarthRing Development Environment Setup Script

set -e

echo "Setting up EarthRing development environment..."

# Check prerequisites
echo "Checking prerequisites..."
command -v go >/dev/null 2>&1 || { echo "Go is required but not installed. Aborting." >&2; exit 1; }
command -v python3 >/dev/null 2>&1 || { echo "Python 3 is required but not installed. Aborting." >&2; exit 1; }
command -v node >/dev/null 2>&1 || { echo "Node.js is required but not installed. Aborting." >&2; exit 1; }
command -v psql >/dev/null 2>&1 || { echo "PostgreSQL is required but not installed. Aborting." >&2; exit 1; }

echo "✓ All prerequisites found"

# Install Go dependencies
echo "Installing Go dependencies..."
cd server
go mod download
go mod tidy
cd ..

# Install Python dependencies
echo "Installing Python dependencies..."
cd server
python3 -m pip install -r requirements.txt
cd ..

# Install Node.js dependencies
echo "Installing Node.js dependencies..."
cd client-web
npm install
cd ..

echo "✓ Development environment setup complete!"
echo ""
echo "Next steps:"
echo "1. Set up PostgreSQL database (see database/schema/init.sql)"
echo "2. Configure environment variables"
echo "3. Run 'go test ./...' to verify Go tests"
echo "4. Run 'pytest' to verify Python tests"
echo "5. Run 'npm test' in client-web to verify JavaScript tests"

