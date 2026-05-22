package main

import "time"

// ─── Domain Types ─────────────────────────────────────────────────────────────

// Message represents a single chat turn stored in History.
type Message struct {
	Role      string
	Content   string
	Timestamp time.Time
}

// ollamaMessage is the internal format for Ollama's Chat API.
type ollamaMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

// ollamaRequest is the body sent to Ollama's /api/chat.
type ollamaRequest struct {
	Model    string                 `json:"model"`
	Messages []ollamaMessage        `json:"messages"`
	Stream   bool                   `json:"stream"`
	Format   interface{}            `json:"format,omitempty"` // "json" or JSON schema
	Options  map[string]interface{} `json:"options,omitempty"`
}

// Directive represents a structured tool call extracted from the LLM stream.
type Directive struct {
	Name string
	Args map[string]any
}
