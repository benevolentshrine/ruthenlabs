package main

import (
	"encoding/json"
	"math"
	"strconv"
	"strings"
)

// ModelProfile holds all model-derived configuration knobs.
// Built once at startup via the Ollama /api/show response.
type ModelProfile struct {
	Name               string
	Family             string
	ParameterSize      string
	ParametersB        float64 // e.g. 3.0, 0.5, 70.0
	ContextWindow      int
	AllowThinking      bool
	MaxRetries         int
	CompactionPct      float64 // 0.0-1.0 threshold to fire compaction
	MaxToolOutputChars int
	MaxMessagesPerTurn int
	Temperature        float64
}

// LoadModelProfile probes the LLM metadata from Ollama and derives config knobs.
// If the model is not found, it falls back to safe defaults for a 3B-class model.
func LoadModelProfile(llm *LLMClient) *ModelProfile {
	p := &ModelProfile{
		Name:               llm.ModelName(),
		ContextWindow:      8192,
		AllowThinking:      false,
		MaxRetries:         2,
		CompactionPct:      0.75,
		MaxToolOutputChars: 2000,
		MaxMessagesPerTurn: 4,
		Temperature:        0.0,
	}

	show, err := llm.ShowModel()
	if err != nil || show == nil {
		return p
	}

	p.Family = show.Details.Family
	p.ParameterSize = show.Details.ParameterSize
	p.ParametersB = parseParamSize(show.Details.ParameterSize)

	// If model_info has exact parameter count, use it (more precise)
	if v, ok := show.ModelInfo["general.parameter_count"]; ok {
		if cnt, ok := toFloat64(v); ok && cnt > 0 {
			p.ParametersB = cnt / 1e9
		}
	}

	// Context window: try architecture-specific key from model_info
	p.ContextWindow = extractContextLen(show.ModelInfo, show.Details.Family)
	if p.ContextWindow == 0 {
		p.ContextWindow = 8192 // safe fallback
	}

	// Derive knobs from model size
	pb := p.ParametersB

	switch {
	case pb < 1.0:
		// Micro tier: 0.5B
		p.AllowThinking = false
		p.MaxRetries = 1
		p.CompactionPct = 0.60
		p.MaxToolOutputChars = 500
		p.MaxMessagesPerTurn = 3
		p.Temperature = 0.0
	case pb < 5.0:
		// Small tier: 1B-3B
		p.AllowThinking = false
		p.MaxRetries = 2
		p.CompactionPct = 0.70
		p.MaxToolOutputChars = 2000
		p.MaxMessagesPerTurn = 4
		p.Temperature = 0.0
	case pb < 15.0:
		// Medium tier: 7B-14B
		p.AllowThinking = true
		p.MaxRetries = 3
		p.CompactionPct = 0.80
		p.MaxToolOutputChars = 4000
		p.MaxMessagesPerTurn = 6
		p.Temperature = 0.1
	case pb < 50.0:
		// Large tier: 22B-34B
		p.AllowThinking = true
		p.MaxRetries = 3
		p.CompactionPct = 0.85
		p.MaxToolOutputChars = 8000
		p.MaxMessagesPerTurn = 8
		p.Temperature = 0.2
	default:
		// Frontier tier: 70B+
		p.AllowThinking = true
		p.MaxRetries = 4
		p.CompactionPct = 0.90
		p.MaxToolOutputChars = 16000
		p.MaxMessagesPerTurn = 10
		p.Temperature = 0.3
	}

	return p
}

// parseParamSize converts strings like "3B", "0.5B", "170B" to a float.
func parseParamSize(s string) float64 {
	s = strings.ToUpper(strings.TrimSpace(s))
	if strings.HasSuffix(s, "B") {
		n := strings.TrimSuffix(s, "B")
		v, err := strconv.ParseFloat(n, 64)
		if err == nil {
			return v
		}
	}
	if strings.HasSuffix(s, "M") {
		n := strings.TrimSuffix(s, "M")
		v, err := strconv.ParseFloat(n, 64)
		if err == nil {
			return v / 1000.0
		}
	}
	return 3.0 // safe fallback
}

// extractContextLen tries to find the context length from model_info.
// Different model families use different keys (llama.context_length, qwen2.context_length, etc.)
func extractContextLen(info map[string]interface{}, family string) int {
	// Try family-specific key first
	familyKey := family + ".context_length"
	if v, ok := info[familyKey]; ok {
		if n, ok := toFloat64(v); ok {
			return int(n)
		}
	}
	// Try llama.context_length as common fallback
	if v, ok := info["llama.context_length"]; ok {
		if n, ok := toFloat64(v); ok {
			return int(n)
		}
	}
	// Scan all keys for any "context_length"
	for k, v := range info {
		if strings.Contains(k, "context_length") {
			if n, ok := toFloat64(v); ok {
				return int(n)
			}
		}
	}
	return 0
}

func toFloat64(v interface{}) (float64, bool) {
	switch n := v.(type) {
	case float64:
		return n, true
	case int:
		return float64(n), true
	case int64:
		return float64(n), true
	case uint64:
		return float64(n), true
	case json.Number:
		if f, err := n.Float64(); err == nil {
			return f, true
		}
	}
	// Try string
	if s, ok := v.(string); ok {
		if f, err := strconv.ParseFloat(s, 64); err == nil {
			// Cap at reasonable limits to avoid overflow
			if f > math.MaxInt32 {
				f = math.MaxInt32
			}
			return f, true
		}
	}
	return 0, false
}
