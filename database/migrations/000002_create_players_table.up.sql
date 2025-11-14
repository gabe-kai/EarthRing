-- Create players table
-- Stores player account information and progression

CREATE TABLE IF NOT EXISTS players (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_login TIMESTAMP,
    level INTEGER DEFAULT 1,
    experience_points BIGINT DEFAULT 0,
    currency_amount BIGINT DEFAULT 0,
    current_position POINT, -- Ring position (x, y)
    current_floor INTEGER DEFAULT 0,
    metadata JSONB -- Flexible storage for game-specific data
);

CREATE INDEX IF NOT EXISTS idx_players_username ON players(username);
CREATE INDEX IF NOT EXISTS idx_players_email ON players(email);

