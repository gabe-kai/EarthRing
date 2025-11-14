#!/bin/bash
# Bash script to run database migrations
# Usage: ./database/migrate.sh [up|down|version] [steps]

set -e

ACTION="${1:-up}"
STEPS="${2:-1}"

# Check if DATABASE_URL is set
if [ -z "$DATABASE_URL" ]; then
    echo "Error: DATABASE_URL environment variable not set."
    echo "Set it with: export DATABASE_URL='postgres://postgres:password@localhost:5432/earthring_dev?sslmode=disable'"
    exit 1
fi

# Check if migrate command exists
if ! command -v migrate &> /dev/null; then
    echo "Error: 'migrate' command not found. Install golang-migrate:"
    echo "  brew install golang-migrate  # Mac"
    echo "  Or download from: https://github.com/golang-migrate/migrate/releases"
    exit 1
fi

MIGRATIONS_PATH="$(dirname "$0")/migrations"

case "$ACTION" in
    up)
        echo "Applying migrations..."
        migrate -path "$MIGRATIONS_PATH" -database "$DATABASE_URL" up
        ;;
    down)
        echo "Rolling back $STEPS migration(s)..."
        migrate -path "$MIGRATIONS_PATH" -database "$DATABASE_URL" down "$STEPS"
        ;;
    version)
        echo "Current migration version:"
        migrate -path "$MIGRATIONS_PATH" -database "$DATABASE_URL" version
        ;;
    force)
        echo "Forcing migration version to $STEPS..."
        echo "WARNING: This should only be used if migrations are in an inconsistent state!"
        migrate -path "$MIGRATIONS_PATH" -database "$DATABASE_URL" force "$STEPS"
        ;;
    *)
        echo "Usage: $0 [up|down|version|force] [steps]"
        exit 1
        ;;
esac

