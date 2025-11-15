"""
Configuration management for procedural generation service.
"""

import os
from typing import Optional


class Config:
    """Configuration for procedural generation service"""

    def __init__(self):
        # Server configuration
        self.host = os.getenv("PROCEDURAL_SERVICE_HOST", "0.0.0.0")
        self.port = int(os.getenv("PROCEDURAL_SERVICE_PORT", "8081"))
        self.environment = os.getenv("ENVIRONMENT", "development")

        # Database configuration (for future use)
        self.db_host = os.getenv("DB_HOST", "localhost")
        self.db_port = int(os.getenv("DB_PORT", "5432"))
        self.db_user = os.getenv("DB_USER", "postgres")
        self.db_password = os.getenv("DB_PASSWORD", "")
        self.db_name = os.getenv("DB_NAME", "earthring_dev")
        self.db_sslmode = os.getenv("DB_SSLMODE", "disable")

        # Generation configuration
        self.world_seed = int(os.getenv("WORLD_SEED", "12345"))
        self.cell_size = float(os.getenv("CELL_SIZE", "50.0"))  # 50m cells

        # Performance configuration
        self.max_parallel_generations = int(os.getenv("MAX_PARALLEL_GENERATIONS", "4"))
        self.cache_enabled = os.getenv("CACHE_ENABLED", "true").lower() == "true"


def load_config() -> Config:
    """Load configuration from environment variables"""
    return Config()

