package database

import (
	"database/sql"
	"fmt"
)

// ConfigStorage handles configuration storage and retrieval
type ConfigStorage struct {
	db *sql.DB
}

// NewConfigStorage creates a new config storage instance
func NewConfigStorage(db *sql.DB) *ConfigStorage {
	return &ConfigStorage{db: db}
}

// GetRegenerationCounter retrieves the current regeneration counter
func (s *ConfigStorage) GetRegenerationCounter() (int, error) {
	var counter int
	query := `
		SELECT regeneration_counter
		FROM structure_regeneration_config
		WHERE id = 1
	`
	err := s.db.QueryRow(query).Scan(&counter)
	if err == sql.ErrNoRows {
		// If row doesn't exist, create it with default value
		_, insertErr := s.db.Exec(`
			INSERT INTO structure_regeneration_config (id, regeneration_counter, updated_at)
			VALUES (1, 0, CURRENT_TIMESTAMP)
			ON CONFLICT (id) DO NOTHING
		`)
		if insertErr != nil {
			return 0, fmt.Errorf("failed to create regeneration config: %w", insertErr)
		}
		return 0, nil
	}
	if err != nil {
		return 0, fmt.Errorf("failed to get regeneration counter: %w", err)
	}
	return counter, nil
}

// IncrementRegenerationCounter increments the regeneration counter and returns the new value
func (s *ConfigStorage) IncrementRegenerationCounter() (int, error) {
	query := `
		INSERT INTO structure_regeneration_config (id, regeneration_counter, updated_at)
		VALUES (1, 1, CURRENT_TIMESTAMP)
		ON CONFLICT (id) 
		DO UPDATE SET 
			regeneration_counter = structure_regeneration_config.regeneration_counter + 1,
			updated_at = CURRENT_TIMESTAMP
		RETURNING regeneration_counter
	`
	var counter int
	err := s.db.QueryRow(query).Scan(&counter)
	if err != nil {
		return 0, fmt.Errorf("failed to increment regeneration counter: %w", err)
	}
	return counter, nil
}

