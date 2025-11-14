package testutil

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
)

// HTTPTestHelper provides utilities for HTTP testing
type HTTPTestHelper struct {
	Handler http.Handler
}

// NewHTTPTestHelper creates a new HTTP test helper
func NewHTTPTestHelper(handler http.Handler) *HTTPTestHelper {
	return &HTTPTestHelper{Handler: handler}
}

// MakeRequest creates and executes an HTTP request, returning the response
func (h *HTTPTestHelper) MakeRequest(method, path string, body interface{}) *httptest.ResponseRecorder {
	var reqBody []byte
	if body != nil {
		var err error
		reqBody, err = json.Marshal(body)
		if err != nil {
			panic(err)
		}
	}

	req := httptest.NewRequest(method, path, bytes.NewBuffer(reqBody))
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}

	rr := httptest.NewRecorder()
	h.Handler.ServeHTTP(rr, req)
	return rr
}

// MakeRequestWithHeaders creates and executes an HTTP request with custom headers
func (h *HTTPTestHelper) MakeRequestWithHeaders(method, path string, body interface{}, headers map[string]string) *httptest.ResponseRecorder {
	var reqBody []byte
	if body != nil {
		var err error
		reqBody, err = json.Marshal(body)
		if err != nil {
			panic(err)
		}
	}

	req := httptest.NewRequest(method, path, bytes.NewBuffer(reqBody))
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}

	for key, value := range headers {
		req.Header.Set(key, value)
	}

	rr := httptest.NewRecorder()
	h.Handler.ServeHTTP(rr, req)
	return rr
}

// ParseJSONResponse parses a JSON response body into a target struct
func ParseJSONResponse(t interface{}, body *bytes.Buffer) error {
	return json.NewDecoder(body).Decode(t)
}

// AssertJSONResponse checks if a response has the expected JSON structure
func AssertJSONResponse(t interface{}, body *bytes.Buffer, expected interface{}) error {
	var actual interface{}
	if err := json.NewDecoder(body).Decode(&actual); err != nil {
		return err
	}

	expectedJSON, err := json.Marshal(expected)
	if err != nil {
		return err
	}

	actualJSON, err := json.Marshal(actual)
	if err != nil {
		return err
	}

	if string(actualJSON) != string(expectedJSON) {
		return fmt.Errorf("expected %s, got %s", string(expectedJSON), string(actualJSON))
	}

	return nil
}

