package testutil

import (
	"strings"
	"testing"
)

func TestRandomString(t *testing.T) {
	str := RandomString(10)
	if len(str) != 10 {
		t.Errorf("Expected string length 10, got %d", len(str))
	}

	// Test multiple times to ensure randomness
	seen := make(map[string]bool)
	for i := 0; i < 10; i++ {
		str2 := RandomString(10)
		if len(str2) != 10 {
			t.Errorf("Expected string length 10, got %d", len(str2))
		}
		if seen[str2] {
			t.Logf("Warning: Duplicate string generated (this is rare but possible)")
		}
		seen[str2] = true
	}
}

func TestRandomUsername(t *testing.T) {
	username := RandomUsername()
	if len(username) == 0 {
		t.Error("Username should not be empty")
	}
	if username[:9] != "testuser_" {
		t.Errorf("Expected username to start with 'testuser_', got %s", username)
	}
}

func TestRandomEmail(t *testing.T) {
	email := RandomEmail()
	if len(email) == 0 {
		t.Error("Email should not be empty")
	}
	if !strings.HasSuffix(email, "@example.com") {
		t.Errorf("Expected email to end with '@example.com', got %s", email)
	}
	if !strings.HasPrefix(email, "test_") {
		t.Errorf("Expected email to start with 'test_', got %s", email)
	}
}

func TestNewTestPlayer(t *testing.T) {
	fixtures := NewTestFixtures()
	player := fixtures.NewTestPlayer()

	if player.Username == "" {
		t.Error("Player username should not be empty")
	}
	if player.Email == "" {
		t.Error("Player email should not be empty")
	}
	if player.Password == "" {
		t.Error("Player password should not be empty")
	}
}

func TestNewTestZone(t *testing.T) {
	fixtures := NewTestFixtures()
	zone := fixtures.NewTestZone()

	if zone.Name == "" {
		t.Error("Zone name should not be empty")
	}
	if zone.Description == "" {
		t.Error("Zone description should not be empty")
	}
}

