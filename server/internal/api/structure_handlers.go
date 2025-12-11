package api

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/earthring/server/internal/auth"
	"github.com/earthring/server/internal/config"
	"github.com/earthring/server/internal/database"
)

// StructureHandlers manages HTTP handlers for structure management.
type StructureHandlers struct {
	storage *database.StructureStorage
	db      *sql.DB
	config  *config.Config
}

// NewStructureHandlers creates a new StructureHandlers instance.
func NewStructureHandlers(db *sql.DB, cfg *config.Config) *StructureHandlers {
	return &StructureHandlers{
		storage: database.NewStructureStorage(db),
		db:      db,
		config:  cfg,
	}
}

type createStructureRequest struct {
	StructureType  string            `json:"structure_type"`
	Floor          int               `json:"floor"`
	OwnerID        *int64            `json:"owner_id,omitempty"`
	ZoneID         *int64            `json:"zone_id,omitempty"`
	IsProcedural   bool              `json:"is_procedural"`
	ProceduralSeed *int64            `json:"procedural_seed,omitempty"`
	Position       database.Position `json:"position"`
	Rotation       float64           `json:"rotation"`
	Scale          float64           `json:"scale"`
	Properties     json.RawMessage   `json:"properties,omitempty"`
	ModelData      json.RawMessage   `json:"model_data,omitempty"`
}

type updateStructureRequest struct {
	StructureType  *string            `json:"structure_type,omitempty"`
	Floor          *int               `json:"floor,omitempty"`
	OwnerID        *int64             `json:"owner_id,omitempty"`
	ZoneID         *int64             `json:"zone_id,omitempty"`
	IsProcedural   *bool              `json:"is_procedural,omitempty"`
	ProceduralSeed *int64             `json:"procedural_seed,omitempty"`
	Position       *database.Position `json:"position,omitempty"`
	Rotation       *float64           `json:"rotation,omitempty"`
	Scale          *float64           `json:"scale,omitempty"`
	Properties     *json.RawMessage   `json:"properties,omitempty"`
	ModelData      *json.RawMessage   `json:"model_data,omitempty"`
}

type structureResponse struct {
	ID                        int64             `json:"id"`
	StructureType             string            `json:"structure_type"`
	Floor                     int               `json:"floor"`
	OwnerID                   *int64            `json:"owner_id,omitempty"`
	ZoneID                    *int64            `json:"zone_id,omitempty"`
	IsProcedural              bool              `json:"is_procedural"`
	ProceduralSeed            *int64            `json:"procedural_seed,omitempty"`
	Position                  database.Position `json:"position"`
	Rotation                  float64           `json:"rotation"`
	Scale                     float64           `json:"scale"`
	Properties                json.RawMessage   `json:"properties,omitempty"`
	ModelData                 json.RawMessage   `json:"model_data,omitempty"`
	ConstructionState         *string           `json:"construction_state,omitempty"`
	ConstructionStartedAt     *time.Time        `json:"construction_started_at,omitempty"`
	ConstructionCompletedAt   *time.Time        `json:"construction_completed_at,omitempty"`
	ConstructionDurationSecs  *int              `json:"construction_duration_seconds,omitempty"`
	CreatedAt                 time.Time         `json:"created_at"`
	UpdatedAt                 time.Time         `json:"updated_at"`
}

// CreateStructure handles POST /api/structures
func (h *StructureHandlers) CreateStructure(w http.ResponseWriter, r *http.Request) {
	authUserID, ok := r.Context().Value(auth.UserIDKey).(int64)
	if !ok {
		respondWithError(w, http.StatusUnauthorized, "Authentication required")
		return
	}

	var req createStructureRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondWithError(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	// Set owner_id to authenticated user if not provided
	if req.OwnerID == nil {
		req.OwnerID = &authUserID
	}

	// Validate that owner_id matches authenticated user (unless admin)
	authRole, _ := r.Context().Value(auth.RoleKey).(string) //nolint:errcheck // ok value ignored - defaults to empty string if not a string
	if req.OwnerID != nil && *req.OwnerID != authUserID && authRole != "admin" {
		respondWithError(w, http.StatusForbidden, "Cannot create structures for other users")
		return
	}

	input := &database.StructureCreateInput{
		StructureType:  req.StructureType,
		Floor:          req.Floor,
		OwnerID:        req.OwnerID,
		ZoneID:         req.ZoneID,
		IsProcedural:   req.IsProcedural,
		ProceduralSeed: req.ProceduralSeed,
		Position:       req.Position,
		Rotation:       req.Rotation,
		Scale:          req.Scale,
		Properties:     req.Properties,
		ModelData:      req.ModelData,
	}

	structure, err := h.storage.CreateStructure(input)
	if err != nil {
		respondWithError(w, http.StatusBadRequest, fmt.Sprintf("Failed to create structure: %v", err))
		return
	}

	writeJSON(w, http.StatusCreated, structureToResponse(structure))
}

// GetStructure handles GET /api/structures/{id}
func (h *StructureHandlers) GetStructure(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimPrefix(r.URL.Path, "/api/structures/")
	id, err := strconv.ParseInt(path, 10, 64)
	if err != nil {
		respondWithError(w, http.StatusBadRequest, "Invalid structure ID")
		return
	}

	structure, err := h.storage.GetStructure(id)
	if err != nil {
		if strings.Contains(err.Error(), "not found") {
			respondWithError(w, http.StatusNotFound, "Structure not found")
			return
		}
		respondWithError(w, http.StatusInternalServerError, fmt.Sprintf("Failed to get structure: %v", err))
		return
	}

	writeJSON(w, http.StatusOK, structureToResponse(structure))
}

// UpdateStructure handles PUT /api/structures/{id}
func (h *StructureHandlers) UpdateStructure(w http.ResponseWriter, r *http.Request) {
	authUserID, ok := r.Context().Value(auth.UserIDKey).(int64)
	if !ok {
		respondWithError(w, http.StatusUnauthorized, "Authentication required")
		return
	}

	path := strings.TrimPrefix(r.URL.Path, "/api/structures/")
	id, err := strconv.ParseInt(path, 10, 64)
	if err != nil {
		respondWithError(w, http.StatusBadRequest, "Invalid structure ID")
		return
	}

	// Get existing structure to check ownership
	existing, err := h.storage.GetStructure(id)
	if err != nil {
		if strings.Contains(err.Error(), "not found") {
			respondWithError(w, http.StatusNotFound, "Structure not found")
			return
		}
		respondWithError(w, http.StatusInternalServerError, fmt.Sprintf("Failed to get structure: %v", err))
		return
	}

	// Check ownership (unless admin)
	authRole, _ := r.Context().Value(auth.RoleKey).(string) //nolint:errcheck // ok value ignored - defaults to empty string if not a string
	if existing.OwnerID == nil || (*existing.OwnerID != authUserID && authRole != "admin") {
		respondWithError(w, http.StatusForbidden, "Cannot update structures owned by other users")
		return
	}

	// Read raw body to check for explicit null values
	bodyBytes, err := io.ReadAll(r.Body)
	if err != nil {
		respondWithError(w, http.StatusBadRequest, "Failed to read request body")
		return
	}

	// Check if zone_id key exists in JSON (even if null)
	var rawReq map[string]interface{}
	if err := json.Unmarshal(bodyBytes, &rawReq); err != nil {
		respondWithError(w, http.StatusBadRequest, "Invalid request body")
		return
	}
	zoneIDKeyExists := false
	if _, exists := rawReq["zone_id"]; exists {
		zoneIDKeyExists = true
	}

	// Decode into struct
	var req updateStructureRequest
	if err := json.Unmarshal(bodyBytes, &req); err != nil {
		respondWithError(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	// Build update input
	input := &database.StructureUpdateInput{}

	if req.StructureType != nil {
		input.StructureType = req.StructureType
	}
	if req.Floor != nil {
		input.Floor = req.Floor
	}
	if req.OwnerID != nil {
		input.OwnerID = req.OwnerID
		input.OwnerIDSet = true
		// Validate ownership change (unless admin)
		if *req.OwnerID != authUserID && authRole != "admin" {
			respondWithError(w, http.StatusForbidden, "Cannot transfer ownership to other users")
			return
		}
	}
	// Set ZoneIDSet if zone_id key exists in JSON (even if null)
	if zoneIDKeyExists {
		input.ZoneID = req.ZoneID
		input.ZoneIDSet = true
	}
	if req.IsProcedural != nil {
		input.IsProcedural = req.IsProcedural
	}
	if req.ProceduralSeed != nil {
		input.ProceduralSeed = req.ProceduralSeed
		input.ProceduralSeedSet = true
	}
	if req.Position != nil {
		input.Position = req.Position
	}
	if req.Rotation != nil {
		input.Rotation = req.Rotation
	}
	if req.Scale != nil {
		input.Scale = req.Scale
	}
	if req.Properties != nil {
		input.Properties = req.Properties
	}
	if req.ModelData != nil {
		input.ModelData = req.ModelData
	}

	structure, err := h.storage.UpdateStructure(id, input)
	if err != nil {
		if strings.Contains(err.Error(), "not found") {
			respondWithError(w, http.StatusNotFound, "Structure not found")
			return
		}
		respondWithError(w, http.StatusBadRequest, fmt.Sprintf("Failed to update structure: %v", err))
		return
	}

	writeJSON(w, http.StatusOK, structureToResponse(structure))
}

// DeleteStructure handles DELETE /api/structures/{id}
func (h *StructureHandlers) DeleteStructure(w http.ResponseWriter, r *http.Request) {
	authUserID, ok := r.Context().Value(auth.UserIDKey).(int64)
	if !ok {
		respondWithError(w, http.StatusUnauthorized, "Authentication required")
		return
	}

	path := strings.TrimPrefix(r.URL.Path, "/api/structures/")
	id, err := strconv.ParseInt(path, 10, 64)
	if err != nil {
		respondWithError(w, http.StatusBadRequest, "Invalid structure ID")
		return
	}

	// Get existing structure to check ownership
	existing, err := h.storage.GetStructure(id)
	if err != nil {
		if strings.Contains(err.Error(), "not found") {
			respondWithError(w, http.StatusNotFound, "Structure not found")
			return
		}
		respondWithError(w, http.StatusInternalServerError, fmt.Sprintf("Failed to get structure: %v", err))
		return
	}

	// Check ownership (unless admin)
	authRole, _ := r.Context().Value(auth.RoleKey).(string) //nolint:errcheck // ok value ignored - defaults to empty string if not a string
	if existing.OwnerID == nil || (*existing.OwnerID != authUserID && authRole != "admin") {
		respondWithError(w, http.StatusForbidden, "Cannot delete structures owned by other users")
		return
	}

	if err := h.storage.DeleteStructure(id); err != nil {
		if strings.Contains(err.Error(), "not found") {
			respondWithError(w, http.StatusNotFound, "Structure not found")
			return
		}
		respondWithError(w, http.StatusInternalServerError, fmt.Sprintf("Failed to delete structure: %v", err))
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// DeleteAllProceduralStructures handles DELETE /api/structures/all/procedural
// Admin-only endpoint that deletes all procedural structures and triggers regeneration.
func (h *StructureHandlers) DeleteAllProceduralStructures(w http.ResponseWriter, r *http.Request) {
	// Check authentication
	_, ok := r.Context().Value(auth.UserIDKey).(int64)
	if !ok {
		respondWithError(w, http.StatusUnauthorized, "Authentication required")
		return
	}

	// Check admin role
	authRole, _ := r.Context().Value(auth.RoleKey).(string) //nolint:errcheck // ok value ignored - defaults to empty string if not a string
	if authRole != "admin" {
		respondWithError(w, http.StatusForbidden, "Admin access required")
		return
	}

	// Delete all procedural structures
	count, err := h.storage.DeleteAllProceduralStructures()
	if err != nil {
		respondWithError(w, http.StatusInternalServerError, fmt.Sprintf("Failed to delete procedural structures: %v", err))
		return
	}

	// Also delete all chunks to force regeneration with new structures
	chunkStorage := database.NewChunkStorage(h.db)
	chunksDeleted, err := chunkStorage.DeleteAllChunks()
	if err != nil {
		respondWithError(w, http.StatusInternalServerError, fmt.Sprintf("Failed to delete chunks: %v", err))
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"message":                "Procedural structures deleted and chunks reset",
		"structures_deleted":     count,
		"chunks_deleted":         chunksDeleted,
		"regeneration_triggered": true,
	})
}

// DeleteAllStructures handles DELETE /api/structures/all
// Admin-only endpoint that deletes all structures (procedural and player), resets ids, and triggers regeneration.
func (h *StructureHandlers) DeleteAllStructures(w http.ResponseWriter, r *http.Request) {
	// Check authentication
	_, ok := r.Context().Value(auth.UserIDKey).(int64)
	if !ok {
		respondWithError(w, http.StatusUnauthorized, "Authentication required")
		return
	}

	// Check admin role
	authRole, _ := r.Context().Value(auth.RoleKey).(string) //nolint:errcheck // ok value ignored - defaults to empty string if not a string
	if authRole != "admin" {
		respondWithError(w, http.StatusForbidden, "Admin access required")
		return
	}

	// Delete all structures and reset the id sequence
	count, err := h.storage.DeleteAllStructures(true)
	if err != nil {
		respondWithError(w, http.StatusInternalServerError, fmt.Sprintf("Failed to delete structures: %v", err))
		return
	}

	// Also delete all chunks to force regeneration with empty structures
	chunkStorage := database.NewChunkStorage(h.db)
	chunksDeleted, err := chunkStorage.DeleteAllChunks()
	if err != nil {
		respondWithError(w, http.StatusInternalServerError, fmt.Sprintf("Failed to delete chunks: %v", err))
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"message":                "All structures deleted, sequence reset, and chunks reset",
		"structures_deleted":     count,
		"chunks_deleted":         chunksDeleted,
		"sequence_reset":         true,
		"regeneration_triggered": true,
	})
}

// ListStructuresByArea handles GET /api/structures/area?x_min={x_min}&x_max={x_max}&y_min={y_min}&y_max={y_max}&floor={floor}
func (h *StructureHandlers) ListStructuresByArea(w http.ResponseWriter, r *http.Request) {
	minXStr := r.URL.Query().Get("x_min")
	maxXStr := r.URL.Query().Get("x_max")
	minYStr := r.URL.Query().Get("y_min")
	maxYStr := r.URL.Query().Get("y_max")
	floorStr := r.URL.Query().Get("floor")

	if minXStr == "" || maxXStr == "" || minYStr == "" || maxYStr == "" || floorStr == "" {
		respondWithError(w, http.StatusBadRequest, "Missing required query parameters: x_min, x_max, y_min, y_max, floor")
		return
	}

	minX, err := strconv.ParseFloat(minXStr, 64)
	if err != nil {
		respondWithError(w, http.StatusBadRequest, "Invalid x_min parameter")
		return
	}

	maxX, err := strconv.ParseFloat(maxXStr, 64)
	if err != nil {
		respondWithError(w, http.StatusBadRequest, "Invalid x_max parameter")
		return
	}

	minY, err := strconv.ParseFloat(minYStr, 64)
	if err != nil {
		respondWithError(w, http.StatusBadRequest, "Invalid y_min parameter")
		return
	}

	maxY, err := strconv.ParseFloat(maxYStr, 64)
	if err != nil {
		respondWithError(w, http.StatusBadRequest, "Invalid y_max parameter")
		return
	}

	floor, err := strconv.Atoi(floorStr)
	if err != nil {
		respondWithError(w, http.StatusBadRequest, "Invalid floor parameter")
		return
	}

	structures, err := h.storage.ListStructuresByArea(minX, maxX, minY, maxY, floor)
	if err != nil {
		respondWithError(w, http.StatusInternalServerError, fmt.Sprintf("Failed to query structures: %v", err))
		return
	}

	responses := make([]structureResponse, len(structures))
	for i, s := range structures {
		responses[i] = structureToResponse(s)
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"structures": responses,
	})
}

// ListStructuresByOwner handles GET /api/structures/owner/{owner_id}
func (h *StructureHandlers) ListStructuresByOwner(w http.ResponseWriter, r *http.Request) {
	authUserID, ok := r.Context().Value(auth.UserIDKey).(int64)
	if !ok {
		respondWithError(w, http.StatusUnauthorized, "Authentication required")
		return
	}

	path := strings.TrimPrefix(r.URL.Path, "/api/structures/owner/")
	ownerID, err := strconv.ParseInt(path, 10, 64)
	if err != nil {
		respondWithError(w, http.StatusBadRequest, "Invalid owner ID")
		return
	}

	// Users can only view their own structures (unless admin)
	authRole, _ := r.Context().Value(auth.RoleKey).(string) //nolint:errcheck // ok value ignored - defaults to empty string if not a string
	if ownerID != authUserID && authRole != "admin" {
		respondWithError(w, http.StatusForbidden, "Cannot view structures owned by other users")
		return
	}

	structures, err := h.storage.ListStructuresByOwner(ownerID)
	if err != nil {
		respondWithError(w, http.StatusInternalServerError, fmt.Sprintf("Failed to query structures: %v", err))
		return
	}

	responses := make([]structureResponse, len(structures))
	for i, s := range structures {
		responses[i] = structureToResponse(s)
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"structures": responses,
	})
}

// structureToResponse converts a database.Structure to a structureResponse.
func structureToResponse(s *database.Structure) structureResponse {
	return structureResponse{
		ID:                       s.ID,
		StructureType:            s.StructureType,
		Floor:                    s.Floor,
		OwnerID:                  s.OwnerID,
		ZoneID:                   s.ZoneID,
		IsProcedural:             s.IsProcedural,
		ProceduralSeed:           s.ProceduralSeed,
		Position:                 s.Position,
		Rotation:                 s.Rotation,
		Scale:                    s.Scale,
		Properties:               s.Properties,
		ModelData:                s.ModelData,
		ConstructionState:        s.ConstructionState,
		ConstructionStartedAt:    s.ConstructionStartedAt,
		ConstructionCompletedAt:  s.ConstructionCompletedAt,
		ConstructionDurationSecs: s.ConstructionDurationSecs,
		CreatedAt:                s.CreatedAt,
		UpdatedAt:                s.UpdatedAt,
	}
}
