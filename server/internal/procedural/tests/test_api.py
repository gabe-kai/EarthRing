"""
Tests for procedural generation API endpoints.
"""

import sys
from pathlib import Path

# Add server directory to path
server_dir = Path(__file__).parent.parent.parent.parent
sys.path.insert(0, str(server_dir))

import pytest
from fastapi.testclient import TestClient
from internal.procedural.main import app

client = TestClient(app)


def test_health_check():
    """Test health check endpoint"""
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert data["service"] == "earthring-procedural-service"
    assert data["version"] == "0.1.0"


def test_generate_chunk():
    """Test chunk generation endpoint"""
    request_data = {"floor": 0, "chunk_index": 12345, "lod_level": "medium"}

    response = client.post("/api/v1/chunks/generate", json=request_data)
    assert response.status_code == 200

    data = response.json()
    assert data["success"] is True
    assert data["chunk"]["chunk_id"] == "0_12345"
    assert data["chunk"]["floor"] == 0
    assert data["chunk"]["chunk_index"] == 12345
    # Chunk 12345 is far from any hub, should have base width
    assert data["chunk"]["width"] == 400.0
    assert data["chunk"]["version"] == 6  # Phase 2 with 4m floor system and new window types version
    # Geometry should be present (Phase 2) - now with smooth curved geometry
    assert data["geometry"] is not None
    assert data["geometry"]["type"] == "ring_floor"
    # With 50m sample interval: 21 samples * 2 vertices = 42 vertices
    # 20 quads * 2 triangles = 40 faces
    assert len(data["geometry"]["vertices"]) == 42
    assert len(data["geometry"]["faces"]) == 40
    assert data["geometry"]["width"] == 400.0
    assert data["geometry"]["length"] == 1000.0
    # Chunk 12345 is outside hub areas, so structures should be empty
    assert isinstance(data["structures"], list)
    # Chunks always include zones (at minimum, restricted zone)
    assert isinstance(data["zones"], list)
    assert len(data["zones"]) > 0  # Should have at least restricted zone


def test_generate_chunk_at_hub_center():
    """Test chunk generation at hub center (should have max width)"""
    # Chunk 0 is at hub 0 center (position 0)
    request_data = {"floor": 0, "chunk_index": 0, "lod_level": "medium"}

    response = client.post("/api/v1/chunks/generate", json=request_data)
    assert response.status_code == 200

    data = response.json()
    assert data["success"] is True
    assert data["chunk"]["chunk_id"] == "0_0"
    # At hub center, width should be close to max (25km = 25000m)
    assert data["chunk"]["width"] > 20000.0
    assert data["chunk"]["width"] <= 25000.0
    # Geometry width should match
    assert data["geometry"]["width"] > 20000.0
    assert data["geometry"]["width"] <= 25000.0
    # Hub chunks should have structures (buildings)
    assert isinstance(data["structures"], list)
    assert len(data["structures"]) > 0
    # Verify structures have correct format with dimensions and subtypes
    for structure in data["structures"]:
        assert "id" in structure
        assert "structure_type" in structure
        assert "dimensions" in structure
        assert structure["dimensions"]["height"] in [5.0, 10.0, 15.0, 20.0]  # Valid heights
        # Buildings should have building_subtype
        if structure.get("structure_type") in ["industrial", "agricultural"]:
            assert "building_subtype" in structure
    # Hub chunks should have multiple zones (restricted, industrial, commercial, mixed-use)
    assert len(data["zones"]) > 1


def test_generate_chunk_with_custom_seed():
    """Test chunk generation with custom world seed"""
    request_data = {
        "floor": 0,
        "chunk_index": 100,
        "lod_level": "medium",
        "world_seed": 99999,
    }

    response = client.post("/api/v1/chunks/generate", json=request_data)
    assert response.status_code == 200

    data = response.json()
    assert data["success"] is True


def test_generate_chunk_validation():
    """Test chunk generation endpoint validation"""
    # Test negative floor
    response = client.post(
        "/api/v1/chunks/generate", json={"floor": -1, "chunk_index": 100}
    )
    assert response.status_code == 422

    # Test negative chunk_index
    response = client.post(
        "/api/v1/chunks/generate", json={"floor": 0, "chunk_index": -1}
    )
    assert response.status_code == 422

    # Test missing required fields
    response = client.post("/api/v1/chunks/generate", json={})
    assert response.status_code == 422


def test_get_chunk_seed():
    """Test get chunk seed endpoint"""
    response = client.get("/api/v1/chunks/seed/0/12345")
    assert response.status_code == 200

    data = response.json()
    assert data["floor"] == 0
    assert data["chunk_index"] == 12345
    assert "chunk_seed" in data
    assert "world_seed" in data

    # Same inputs should produce same seed
    response2 = client.get("/api/v1/chunks/seed/0/12345")
    assert response2.json()["chunk_seed"] == data["chunk_seed"]


def test_get_chunk_seed_with_custom_world_seed():
    """Test get chunk seed with custom world seed"""
    response = client.get("/api/v1/chunks/seed/0/100?world_seed=99999")
    assert response.status_code == 200

    data = response.json()
    assert data["world_seed"] == 99999
