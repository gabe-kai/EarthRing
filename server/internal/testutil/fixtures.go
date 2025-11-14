package testutil

import (
	"time"
)

// TestFixtures provides test data generators
type TestFixtures struct{}

// NewTestFixtures creates a new test fixtures helper
func NewTestFixtures() *TestFixtures {
	return &TestFixtures{}
}

// RandomString generates a random string of specified length
func RandomString(length int) string {
	const charset = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
	b := make([]byte, length)
	seed := time.Now().UnixNano()
	for i := range b {
		seed = seed*1103515245 + 12345 // Simple LCG
		idx := int(seed % int64(len(charset)))
		if idx < 0 {
			idx = -idx
		}
		b[i] = charset[idx]
	}
	return string(b)
}

// RandomUsername generates a random username
func RandomUsername() string {
	return "testuser_" + RandomString(8)
}

// RandomEmail generates a random email address
func RandomEmail() string {
	return "test_" + RandomString(8) + "@example.com"
}

// TestPlayerData represents test player data
type TestPlayerData struct {
	Username string
	Email    string
	Password string
}

// NewTestPlayer creates test player data
func (f *TestFixtures) NewTestPlayer() TestPlayerData {
	return TestPlayerData{
		Username: RandomUsername(),
		Email:    RandomEmail(),
		Password: "testpassword123",
	}
}

// TestZoneData represents test zone data
type TestZoneData struct {
	Name        string
	Description string
	Floor       int
}

// NewTestZone creates test zone data
func (f *TestFixtures) NewTestZone() TestZoneData {
	return TestZoneData{
		Name:        "Test Zone " + RandomString(6),
		Description: "A test zone for testing",
		Floor:       0,
	}
}

