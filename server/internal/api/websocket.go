package api

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/earthring/server/internal/auth"
	"github.com/earthring/server/internal/config"
	"github.com/gorilla/websocket"
)

const (
	// Supported WebSocket protocol versions
	ProtocolVersion1 = "earthring-v1"

	// Default ping interval (30 seconds)
	defaultPingInterval = 30 * time.Second

	// Pong wait timeout (60 seconds)
	pongWait = 60 * time.Second

	// Write timeout (10 seconds)
	writeTimeout = 10 * time.Second
)

// WebSocketConnection represents an active WebSocket connection
type WebSocketConnection struct {
	conn     *websocket.Conn
	userID   int64
	username string
	role     string
	version  string
	send     chan []byte
	hub      *WebSocketHub
}

// WebSocketHub manages all active WebSocket connections
type WebSocketHub struct {
	connections map[*WebSocketConnection]bool
	broadcast   chan []byte
	register    chan *WebSocketConnection
	unregister  chan *WebSocketConnection
	mu          sync.RWMutex
}

// WebSocketMessage represents a WebSocket message
type WebSocketMessage struct {
	Type string          `json:"type"`
	ID   string          `json:"id,omitempty"`
	Data json.RawMessage `json:"data,omitempty"`
}

// WebSocketError represents an error message sent over WebSocket
type WebSocketError struct {
	Type    string `json:"type"`
	ID      string `json:"id,omitempty"`
	Error   string `json:"error"`
	Message string `json:"message"`
	Code    string `json:"code,omitempty"`
}

// NewWebSocketHub creates a new WebSocket hub
func NewWebSocketHub() *WebSocketHub {
	return &WebSocketHub{
		connections: make(map[*WebSocketConnection]bool),
		broadcast:   make(chan []byte, 256),
		register:    make(chan *WebSocketConnection),
		unregister:  make(chan *WebSocketConnection),
	}
}

// Run starts the hub's main loop
func (h *WebSocketHub) Run() {
	for {
		select {
		case conn := <-h.register:
			h.mu.Lock()
			h.connections[conn] = true
			h.mu.Unlock()
			log.Printf("WebSocket connection registered: user_id=%d, version=%s", conn.userID, conn.version)

		case conn := <-h.unregister:
			h.mu.Lock()
			if _, ok := h.connections[conn]; ok {
				delete(h.connections, conn)
				close(conn.send)
			}
			h.mu.Unlock()
			log.Printf("WebSocket connection unregistered: user_id=%d", conn.userID)

		case message := <-h.broadcast:
			h.mu.RLock()
			for conn := range h.connections {
				select {
				case conn.send <- message:
				default:
					close(conn.send)
					delete(h.connections, conn)
				}
			}
			h.mu.RUnlock()
		}
	}
}

// Broadcast sends a message to all connected clients
func (h *WebSocketHub) Broadcast(message []byte) {
	h.broadcast <- message
}

// SendToUser sends a message to a specific user
func (h *WebSocketHub) SendToUser(userID int64, message []byte) {
	h.mu.RLock()
	defer h.mu.RUnlock()

	for conn := range h.connections {
		if conn.userID == userID {
			select {
			case conn.send <- message:
			default:
				close(conn.send)
				delete(h.connections, conn)
			}
		}
	}
}

// WebSocketHandlers handles WebSocket connections
type WebSocketHandlers struct {
	hub        *WebSocketHub
	db         *sql.DB
	config     *config.Config
	jwtService *auth.JWTService
	upgrader   websocket.Upgrader
}

// NewWebSocketHandlers creates a new WebSocket handlers instance
func NewWebSocketHandlers(db *sql.DB, cfg *config.Config) *WebSocketHandlers {
	jwtService := auth.NewJWTService(cfg)

	// Get allowed origins from config or use defaults
	allowedOrigins := []string{
		"http://localhost:3000",
		"http://localhost:5173",
		"http://127.0.0.1:3000",
		"http://127.0.0.1:5173",
	}

	return &WebSocketHandlers{
		hub:        NewWebSocketHub(),
		db:         db,
		config:     cfg,
		jwtService: jwtService,
		upgrader: websocket.Upgrader{
			ReadBufferSize:  1024,
			WriteBufferSize: 1024,
			CheckOrigin: func(r *http.Request) bool {
				origin := r.Header.Get("Origin")
				for _, allowed := range allowedOrigins {
					if origin == allowed {
						return true
					}
				}
				return false
			},
		},
	}
}

// HandleWebSocket handles WebSocket connection upgrades
func (h *WebSocketHandlers) HandleWebSocket(w http.ResponseWriter, r *http.Request) {
	// Authenticate the connection
	token, err := h.extractToken(r)
	if err != nil {
		log.Printf("WebSocket authentication failed: %v", err)
		http.Error(w, "Authentication required", http.StatusUnauthorized)
		return
	}

	// Validate token
	claims, err := h.jwtService.ValidateAccessToken(token)
	if err != nil {
		log.Printf("WebSocket token validation failed: %v", err)
		http.Error(w, "Invalid token", http.StatusUnauthorized)
		return
	}

	// Negotiate protocol version
	requestedVersions := r.Header.Get("Sec-WebSocket-Protocol")
	selectedVersion := h.negotiateVersion(requestedVersions)
	if selectedVersion == "" {
		log.Printf("WebSocket version negotiation failed: requested=%s", requestedVersions)
		http.Error(w, "Unsupported protocol version", http.StatusBadRequest)
		return
	}

	// Set the selected protocol version in response headers
	responseHeaders := http.Header{}
	responseHeaders.Set("Sec-WebSocket-Protocol", selectedVersion)

	// Upgrade connection
	conn, err := h.upgrader.Upgrade(w, r, responseHeaders)
	if err != nil {
		log.Printf("WebSocket upgrade failed: %v", err)
		return
	}

	// Create connection object
	wsConn := &WebSocketConnection{
		conn:     conn,
		userID:   claims.UserID,
		username: claims.Username,
		role:     claims.Role,
		version:  selectedVersion,
		send:     make(chan []byte, 256),
		hub:      h.hub,
	}

	// Register connection
	h.hub.register <- wsConn

	// Start connection handlers
	go wsConn.writePump()
	go wsConn.readPump(h)
}

// extractToken extracts JWT token from request (query param or header)
func (h *WebSocketHandlers) extractToken(r *http.Request) (string, error) {
	// Try query parameter first (common for WebSocket)
	token := r.URL.Query().Get("token")
	if token != "" {
		return token, nil
	}

	// Try Authorization header
	authHeader := r.Header.Get("Authorization")
	if authHeader != "" {
		parts := strings.Split(authHeader, " ")
		if len(parts) == 2 && parts[0] == "Bearer" {
			return parts[1], nil
		}
	}

	return "", fmt.Errorf("missing authentication token")
}

// negotiateVersion selects the highest supported protocol version
func (h *WebSocketHandlers) negotiateVersion(requested string) string {
	if requested == "" {
		// Default to v1 if no version specified
		return ProtocolVersion1
	}

	// Parse requested versions (comma-separated)
	requestedVersions := strings.Split(requested, ",")
	for i := range requestedVersions {
		requestedVersions[i] = strings.TrimSpace(requestedVersions[i])
	}

	// Supported versions in order (highest first)
	supportedVersions := []string{ProtocolVersion1}

	// Find highest mutually supported version
	for _, supported := range supportedVersions {
		for _, requested := range requestedVersions {
			if requested == supported {
				return supported
			}
		}
	}

	return ""
}

// readPump handles incoming messages from the WebSocket connection
func (c *WebSocketConnection) readPump(handlers *WebSocketHandlers) {
	defer func() {
		c.hub.unregister <- c
		c.conn.Close()
	}()

	if err := c.conn.SetReadDeadline(time.Now().Add(pongWait)); err != nil {
		log.Printf("Failed to set read deadline: %v", err)
	}
	c.conn.SetPongHandler(func(string) error {
		if err := c.conn.SetReadDeadline(time.Now().Add(pongWait)); err != nil {
			log.Printf("Failed to set read deadline in pong handler: %v", err)
		}
		return nil
	})

	for {
		_, messageBytes, err := c.conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				log.Printf("WebSocket error: %v", err)
			}
			break
		}

		// Parse message
		var msg WebSocketMessage
		if err := json.Unmarshal(messageBytes, &msg); err != nil {
			c.sendError("invalid_message", "Invalid message format", "InvalidMessageFormat")
			continue
		}

		// Handle message based on type
		handlers.handleMessage(c, &msg)
	}
}

// writePump handles outgoing messages to the WebSocket connection
func (c *WebSocketConnection) writePump() {
	ticker := time.NewTicker(defaultPingInterval)
	defer func() {
		ticker.Stop()
		c.conn.Close()
	}()

	for {
		select {
		case message, ok := <-c.send:
			if err := c.conn.SetWriteDeadline(time.Now().Add(writeTimeout)); err != nil {
				log.Printf("Failed to set write deadline: %v", err)
				return
			}
			if !ok {
				if err := c.conn.WriteMessage(websocket.CloseMessage, []byte{}); err != nil {
					log.Printf("Failed to write close message: %v", err)
				}
				return
			}

			w, err := c.conn.NextWriter(websocket.TextMessage)
			if err != nil {
				return
			}
			if _, err := w.Write(message); err != nil {
				_ = w.Close()
				return
			}

			// Send queued messages
			n := len(c.send)
			for i := 0; i < n; i++ {
				if _, err := w.Write([]byte{'\n'}); err != nil {
					_ = w.Close()
					return
				}
				if _, err := w.Write(<-c.send); err != nil {
					_ = w.Close()
					return
				}
			}

			if err := w.Close(); err != nil {
				return
			}

		case <-ticker.C:
			if err := c.conn.SetWriteDeadline(time.Now().Add(writeTimeout)); err != nil {
				log.Printf("Failed to set write deadline for ping: %v", err)
				return
			}
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

// sendError sends an error message to the client
func (c *WebSocketConnection) sendError(id, errorMsg, code string) {
	errorResp := WebSocketError{
		Type:    "error",
		ID:      id,
		Error:   errorMsg,
		Message: errorMsg,
		Code:    code,
	}

	messageBytes, err := json.Marshal(errorResp)
	if err != nil {
		log.Printf("Failed to marshal error message: %v", err)
		return
	}

	select {
	case c.send <- messageBytes:
	default:
		log.Printf("Failed to send error message: channel full")
	}
}

// handleMessage routes messages to appropriate handlers
func (h *WebSocketHandlers) handleMessage(conn *WebSocketConnection, msg *WebSocketMessage) {
	switch msg.Type {
	case "ping":
		h.handlePing(conn, msg)
	case "chunk_request":
		h.handleChunkRequest(conn, msg)
	case "player_move":
		h.handlePlayerMove(conn, msg)
	default:
		conn.sendError(msg.ID, "Unknown message type", "UnknownMessageType")
	}
}

// handlePing responds to ping messages
func (h *WebSocketHandlers) handlePing(conn *WebSocketConnection, msg *WebSocketMessage) {
	response := WebSocketMessage{
		Type: "pong",
		ID:   msg.ID,
	}

	responseBytes, err := json.Marshal(response)
	if err != nil {
		log.Printf("Failed to marshal pong response: %v", err)
		return
	}

	select {
	case conn.send <- responseBytes:
	default:
		log.Printf("Failed to send pong: channel full")
	}
}

// handleChunkRequest handles chunk request messages (placeholder for Phase 2)
func (h *WebSocketHandlers) handleChunkRequest(conn *WebSocketConnection, msg *WebSocketMessage) {
	// TODO: Implement in Phase 2
	conn.sendError(msg.ID, "Chunk requests not yet implemented", "NotImplemented")
}

// handlePlayerMove handles player movement updates
func (h *WebSocketHandlers) handlePlayerMove(conn *WebSocketConnection, msg *WebSocketMessage) {
	// TODO: Implement player movement handling
	// For now, just acknowledge receipt
	response := WebSocketMessage{
		Type: "player_move_ack",
		ID:   msg.ID,
	}

	responseBytes, err := json.Marshal(response)
	if err != nil {
		log.Printf("Failed to marshal player_move_ack: %v", err)
		return
	}

	select {
	case conn.send <- responseBytes:
	default:
		log.Printf("Failed to send player_move_ack: channel full")
	}
}

// GetHub returns the WebSocket hub (for use in other packages)
func (h *WebSocketHandlers) GetHub() *WebSocketHub {
	return h.hub
}
