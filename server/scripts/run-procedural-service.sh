#!/bin/bash
# Run the procedural generation service

cd "$(dirname "$0")/.." || exit

# Activate virtual environment if it exists
if [ -d "venv" ]; then
    source venv/bin/activate
fi

# Run the service
python -m uvicorn internal.procedural.main:app \
    --host "${PROCEDURAL_SERVICE_HOST:-0.0.0.0}" \
    --port "${PROCEDURAL_SERVICE_PORT:-8081}" \
    --reload

