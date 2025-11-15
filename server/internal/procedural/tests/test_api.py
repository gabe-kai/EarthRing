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
    request_data = {
        "floor": 0,
        "chunk_index": 12345,
        "lod_level": "medium"
    }
    
    response = client.post("/api/v1/chunks/generate", json=request_data)
    assert response.status_code == 200
    
    data = response.json()
    assert data["success"] is True
    assert data["chunk"]["chunk_id"] == "0_12345"
    assert data["chunk"]["floor"] == 0
    assert data["chunk"]["chunk_index"] == 12345
    assert data["chunk"]["width"] == 400.0
    assert data["geometry"] is None
    assert data["structures"] == []
    assert data["zones"] == []


def test_generate_chunk_with_custom_seed():
    """Test chunk generation with custom world seed"""
    request_data = {
        "floor": 0,
        "chunk_index": 100,
        "lod_level": "medium",
        "world_seed": 99999
    }
    
    response = client.post("/api/v1/chunks/generate", json=request_data)
    assert response.status_code == 200
    
    data = response.json()
    assert data["success"] is True


def test_generate_chunk_validation():
    """Test chunk generation endpoint validation"""
    # Test negative floor
    response = client.post("/api/v1/chunks/generate", json={
        "floor": -1,
        "chunk_index": 100
    })
    assert response.status_code == 422
    
    # Test negative chunk_index
    response = client.post("/api/v1/chunks/generate", json={
        "floor": 0,
        "chunk_index": -1
    })
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

