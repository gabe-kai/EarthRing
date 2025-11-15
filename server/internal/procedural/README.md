# Procedural Generation Service

Python service for generating procedural chunks, buildings, and city elements for EarthRing.

## Overview

This service handles all procedural generation tasks, communicating with the main Go server via REST API. It uses deterministic, seed-based algorithms to ensure consistent generation across all clients.

## Setup

1. **Install dependencies:**
   ```bash
   pip install -r requirements.txt
   ```

2. **Configure environment variables** (optional, defaults provided):
   ```bash
   export PROCEDURAL_SERVICE_HOST=0.0.0.0
   export PROCEDURAL_SERVICE_PORT=8081
   export WORLD_SEED=12345
   export ENVIRONMENT=development
   ```

3. **Run the service:**
   ```bash
   # From server directory
   python -m internal.procedural.main
   
   # Or using uvicorn directly
   uvicorn internal.procedural.main:app --host 0.0.0.0 --port 8081 --reload
   ```

## API Endpoints

### Health Check
```
GET /health
```
Returns service status and version.

### Generate Chunk
```
POST /api/v1/chunks/generate
Content-Type: application/json

{
  "floor": 0,
  "chunk_index": 12345,
  "lod_level": "medium",
  "world_seed": 12345  // Optional
}
```

### Get Chunk Seed
```
GET /api/v1/chunks/seed/{floor}/{chunk_index}?world_seed=12345
```
Returns the deterministic seed for a chunk (useful for debugging).

## Testing

Run tests:
```bash
# From server directory
pytest internal/procedural/tests/ -v
```

## Architecture

- **main.py**: FastAPI application and endpoints
- **config.py**: Configuration management
- **seeds.py**: Seed generation utilities (deterministic)
- **generation.py**: Chunk generation functions (Phase 1: empty chunks)

## Phase 1 Status

Currently returns empty chunks with metadata only. Full generation (buildings, zones, etc.) will be implemented in Phase 2.

