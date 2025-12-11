"""
EarthRing Procedural Generation Service
Main entry point for the Python procedural generation service.
"""

import os
import sys
from pathlib import Path

# Add server directory to path for imports
server_dir = Path(__file__).parent.parent.parent
sys.path.insert(0, str(server_dir))

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any
import uvicorn

from internal.procedural import config
from internal.procedural import seeds
from internal.procedural import generation

app = FastAPI(
    title="EarthRing Procedural Generation Service",
    description="Service for generating procedural chunks, buildings, and city elements",
    version="0.1.0",
)

# CORS middleware (allow Go server to call this service)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, restrict to Go server URL
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Load configuration
cfg = config.load_config()


class HealthResponse(BaseModel):
    """Health check response"""

    status: str
    service: str
    version: str


class GenerateChunkRequest(BaseModel):
    """Request to generate a chunk"""

    floor: int = Field(..., ge=0, description="Floor number")
    chunk_index: int = Field(..., ge=0, description="Chunk index")
    lod_level: str = Field(
        default="medium", description="Level of detail: low, medium, high"
    )
    world_seed: Optional[int] = Field(
        default=None, description="World seed (uses default if not provided)"
    )
    regeneration_counter: Optional[int] = Field(
        default=None, description="Regeneration counter for complete regeneration (affects building placement)"
    )


class ChunkGeometry(BaseModel):
    """Chunk geometry data"""

    # For Phase 2, geometry is a flexible dict structure
    # Can contain vertices, faces, normals, etc.
    type: str
    vertices: List[List[float]]
    faces: List[List[int]]
    normals: List[List[float]]
    width: float
    length: float


class VersionMetadata(BaseModel):
    """Version metadata for granular version checking"""

    geometry_version: int
    sample_interval: Optional[float] = None
    algorithm: Optional[str] = None
    vertex_count: Optional[int] = None
    face_count: Optional[int] = None


class ChunkMetadata(BaseModel):
    """Chunk metadata"""

    chunk_id: str
    floor: int
    chunk_index: int
    width: float
    version: int = 1
    version_metadata: Optional[VersionMetadata] = None


class GenerateChunkResponse(BaseModel):
    """Response from chunk generation"""

    success: bool
    chunk: ChunkMetadata
    geometry: Optional[ChunkGeometry] = None
    structures: List[Dict[str, Any]] = []
    zones: List[Dict[str, Any]] = []
    message: Optional[str] = None


@app.get("/health", response_model=HealthResponse)
async def health_check():
    """Health check endpoint"""
    return HealthResponse(
        status="ok",
        service="earthring-procedural-service",
        version="0.1.0",
    )


@app.post("/api/v1/chunks/generate", response_model=GenerateChunkResponse)
async def generate_chunk(request: GenerateChunkRequest):
    """
    Generate a procedural chunk.

    For Phase 1, this returns empty chunks with metadata only.
    Full generation will be implemented in Phase 2.
    """
    try:
        # Get world seed (use default if not provided)
        world_seed = (
            request.world_seed if request.world_seed is not None else cfg.world_seed
        )

        # Generate chunk seed
        chunk_seed = seeds.get_chunk_seed(
            request.floor, request.chunk_index, world_seed
        )

        # Generate chunk with geometry (Phase 2)
        # Pass regeneration_counter to affect building placement
        regeneration_counter = request.regeneration_counter if request.regeneration_counter is not None else 0
        chunk_data = generation.generate_chunk(
            request.floor, request.chunk_index, chunk_seed, regeneration_counter
        )

        chunk_id = chunk_data["chunk_id"]
        chunk_width = chunk_data["metadata"]["chunk_width"]
        geometry_data = chunk_data.get("geometry")

        # Convert geometry dict to ChunkGeometry model if present
        geometry_model = None
        if geometry_data:
            geometry_model = ChunkGeometry(**geometry_data)

        # Extract version metadata if present
        version_metadata = None
        if "version_metadata" in chunk_data.get("metadata", {}):
            vm = chunk_data["metadata"]["version_metadata"]
            version_metadata = VersionMetadata(
                geometry_version=vm.get(
                    "geometry_version", chunk_data["metadata"]["version"]
                ),
                sample_interval=vm.get("sample_interval"),
                algorithm=vm.get("algorithm"),
                vertex_count=vm.get("vertex_count"),
                face_count=vm.get("face_count"),
            )

        response = GenerateChunkResponse(
            success=True,
            chunk=ChunkMetadata(
                chunk_id=chunk_id,
                floor=request.floor,
                chunk_index=request.chunk_index,
                width=chunk_width,
                version=chunk_data["metadata"]["version"],
                version_metadata=version_metadata,
            ),
            geometry=geometry_model,
            structures=chunk_data.get("structures", []),
            zones=chunk_data.get("zones", []),
            message="Chunk generated with ring floor geometry (Phase 2 MVP)",
        )

        return response

    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to generate chunk: {str(e)}"
        )


@app.get("/api/v1/chunks/seed/{floor}/{chunk_index}")
async def get_chunk_seed(
    floor: int, chunk_index: int, world_seed: Optional[int] = None
):
    """Get the seed for a specific chunk (useful for debugging)"""
    seed = world_seed if world_seed is not None else cfg.world_seed
    chunk_seed = seeds.get_chunk_seed(floor, chunk_index, seed)

    return {
        "floor": floor,
        "chunk_index": chunk_index,
        "world_seed": seed,
        "chunk_seed": chunk_seed,
    }


if __name__ == "__main__":
    port = int(os.getenv("PROCEDURAL_SERVICE_PORT", "8081"))
    host = os.getenv("PROCEDURAL_SERVICE_HOST", "0.0.0.0")

    uvicorn.run(
        "main:app", host=host, port=port, reload=cfg.environment == "development"
    )
