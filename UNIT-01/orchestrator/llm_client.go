package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"time"
)

const (
	dialTimeout        = 10 * time.Second
	responseHeaderTimeout = 120 * time.Second
)

type LLMClient struct {
	endpoint   string
	model      string
	httpClient *http.Client
	showCache  *ModelShowResponse
}

type ModelShowResponse struct {
	Modelfile  string                 `json:"modelfile"`
	Parameters string                 `json:"parameters"`
	Template   string                 `json:"template"`
	Details    ModelDetails           `json:"details"`
	ModelInfo  map[string]interface{} `json:"model_info"`
}

type ModelDetails struct {
	ParentModel       string   `json:"parent_model"`
	Format            string   `json:"format"`
	Family            string   `json:"family"`
	Families          []string `json:"families"`
	ParameterSize     string   `json:"parameter_size"`
	QuantizationLevel string   `json:"quantization_level"`
}

func NewLLMClient(endpoint, defaultModel string) *LLMClient {
	if endpoint == "" {
		endpoint = "http://127.0.0.1:11434"
	}
	return &LLMClient{
		endpoint: endpoint,
		model:    defaultModel,
		httpClient: &http.Client{
			Transport: &http.Transport{
				DialContext: (&net.Dialer{
					Timeout: dialTimeout,
				}).DialContext,
				TLSHandshakeTimeout:   dialTimeout,
				ResponseHeaderTimeout: responseHeaderTimeout,
			},
		},
	}
}

// ShowModel fetches full model metadata from /api/show. Result is cached.
func (c *LLMClient) ShowModel() (*ModelShowResponse, error) {
	if c.showCache != nil {
		return c.showCache, nil
	}
	resp, err := c.httpClient.Post(c.endpoint+"/api/show", "application/json",
		bytes.NewBufferString(fmt.Sprintf(`{"name":"%s"}`, c.model)))
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	var show ModelShowResponse
	if err := json.NewDecoder(resp.Body).Decode(&show); err != nil {
		return nil, err
	}
	c.showCache = &show
	return c.showCache, nil
}

// directiveResult is the JSON structure returned by the model under schema constraint.
type directiveResult struct {
	Directives []struct {
		Name string                 `json:"name"`
		Args map[string]interface{} `json:"args"`
	} `json:"directives"`
}

// StreamDirectives sends a request with the directive JSON schema, returns parsed directives.
func (c *LLMClient) StreamDirectives(messages []ollamaMessage, temperature float64) ([]Directive, int, int, error) {
	reqBody := ollamaRequest{
		Model:    c.model,
		Messages: messages,
		Stream:   true,
		Format:   directiveSchema,
		Options: map[string]interface{}{
			"temperature": temperature,
		},
	}

	b, err := json.Marshal(reqBody)
	if err != nil {
		return nil, 0, 0, fmt.Errorf("marshal request: %w", err)
	}

	req, err := http.NewRequest("POST", c.endpoint+"/api/chat", bytes.NewReader(b))
	if err != nil {
		return nil, 0, 0, fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, 0, 0, fmt.Errorf("http: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(resp.Body)
		return nil, 0, 0, fmt.Errorf("status %d: %s", resp.StatusCode, string(b))
	}

	fullText, _, promptTokens, outputTokens, err := ParseStreamCLI(resp.Body, io.Discard, nil)
	if err != nil {
		return nil, 0, 0, err
	}

	// Parse the JSON-structured output into directives.
	var result directiveResult
	if err := json.Unmarshal([]byte(fullText), &result); err != nil {
		return nil, promptTokens, outputTokens, fmt.Errorf("parse directive JSON: %w\nraw: %s", err, fullText)
	}

	directives := make([]Directive, 0, len(result.Directives))
	for _, d := range result.Directives {
		directives = append(directives, Directive{Name: d.Name, Args: d.Args})
	}
	return directives, promptTokens, outputTokens, nil
}

// StreamCLI sends a chat request to Ollama with streaming and directive parsing.
func (c *LLMClient) StreamCLI(messages []ollamaMessage, w io.Writer, stopSpinner func(), temperature float64) (string, []Directive, int, int, error) {
	reqBody := ollamaRequest{
		Model:    c.model,
		Messages: messages,
		Stream:   true,
		Options: map[string]interface{}{
			"temperature": temperature,
		},
	}

	b, err := json.Marshal(reqBody)
	if err != nil {
		return "", nil, 0, 0, fmt.Errorf("marshal request: %w", err)
	}

	req, err := http.NewRequest("POST", c.endpoint+"/api/chat", bytes.NewReader(b))
	if err != nil {
		return "", nil, 0, 0, fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return "", nil, 0, 0, fmt.Errorf("http: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(resp.Body)
		return "", nil, 0, 0, fmt.Errorf("status %d: %s", resp.StatusCode, string(b))
	}

	return ParseStreamCLI(resp.Body, w, stopSpinner)
}

// Chat performs a synchronous non-streaming request.
func (c *LLMClient) Chat(messages []ollamaMessage) (string, error) {
	reqBody := ollamaRequest{
		Model:    c.model,
		Messages: messages,
		Stream:   false,
	}

	b, err := json.Marshal(reqBody)
	if err != nil {
		return "", err
	}

	resp, err := c.httpClient.Post(c.endpoint+"/api/chat", "application/json", bytes.NewReader(b))
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	var chatResp struct {
		Message struct {
			Content string `json:"content"`
		} `json:"message"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&chatResp); err != nil {
		return "", err
	}
	return chatResp.Message.Content, nil
}

// ModelName returns the active model name.
func (c *LLMClient) ModelName() string { return c.model }
