package main

import (
	"fmt"
	"strings"
	"time"
)

// ─── Constants ────────────────────────────────────────────────────────────────

// maxHistory is the maximum number of messages retained in the chat ring.
// When the limit is reached the two oldest messages (one user + one assistant)
// are evicted together so history always starts on a user turn.
const maxHistory = 1000

// ─── History ──────────────────────────────────────────────────────────────────

// History manages the bounded chat message slice.
type History struct {
	messages []Message
}

// newHistory returns an empty History with pre-allocated backing storage.
func newHistory() History {
	return History{messages: make([]Message, 0, maxHistory)}
}

// Append adds a message, evicting the oldest pair when the cap is reached.
func (h *History) Append(m Message) {
	if len(h.messages) >= maxHistory {
		h.evictOldest()
	}
	h.messages = append(h.messages, m)
}

// evictOldest removes the two oldest messages (one exchange) so history always
// begins with a user turn. If only one message exists, it is removed.
func (h *History) evictOldest() {
	switch {
	case len(h.messages) == 0:
		return
	case len(h.messages) == 1:
		h.messages = h.messages[1:]
	default:
		// Drop the first two (user + assistant pair).
		h.messages = h.messages[2:]
	}
}

// evictLast removes the most recent message.
func (h *History) evictLast() {
	if len(h.messages) > 0 {
		h.messages = h.messages[:len(h.messages)-1]
	}
}

// Compact replaces the first 'count' messages with a single summary message.
func (h *History) Compact(summary string, count int) {
	if count > len(h.messages) {
		count = len(h.messages)
	}

	summaryMsg := Message{
		Role:      "system",
		Content:   "📦 CONTEXT COMPACTED: " + summary,
		Timestamp: time.Now(),
	}

	// Replace range with summary.
	h.messages = append([]Message{summaryMsg}, h.messages[count:]...)
}

// TokenEstimate returns a rough token count (4 chars per token) for all messages.
// No tokenizer dependency needed for open-core — estimates are conservative.
func (h *History) TokenEstimate() int {
	var total int
	for _, m := range h.messages {
		total += len(m.Content) / 4
	}
	return total
}

// All returns a read-only view of all messages.
func (h *History) All() []Message { return h.messages }

// Len returns the number of stored messages.
func (h *History) Len() int { return len(h.messages) }

// Last returns a pointer to the last message, or nil if empty.
func (h *History) Last() *Message {
	if len(h.messages) == 0 {
		return nil
	}
	return &h.messages[len(h.messages)-1]
}

// AppendUserTurn is a convenience wrapper for adding a user message.
func (h *History) AppendUserTurn(content string) {
	h.Append(Message{Role: "user", Content: content, Timestamp: time.Now()})
}

// AppendAssistantPlaceholder appends the "Thinking…" sentinel the LLM stream
// will overwrite token-by-token.
func (h *History) AppendAssistantPlaceholder() {
	h.Append(Message{Role: "assistant", Content: "Thinking…", Timestamp: time.Now()})
}

// ReplaceLastContent overwrites the Content field of the last message.
// No-op if the history is empty or the last message role doesn't match.
func (h *History) ReplaceLastContent(role, content string) {
	last := h.Last()
	if last == nil || last.Role != role {
		return
	}
	last.Content = content
}

// AppendLastContent concatenates text onto the last message's Content field,
// replacing the "Thinking…" placeholder on first call.
func (h *History) AppendLastContent(role, delta string) {
	last := h.Last()
	if last == nil || last.Role != role {
		return
	}
	if last.Content == "Thinking…" {
		last.Content = delta
	} else {
		last.Content += delta
	}
}

// PurgeSystemMessages removes raw tool outputs while preserving success confirmations.
func (h *History) PurgeSystemMessages() {
	newMsgs := make([]Message, 0, len(h.messages))
	for _, m := range h.messages {
		if m.Role != "system" || strings.HasPrefix(m.Content, "✅") {
			newMsgs = append(newMsgs, m)
		}
	}
	h.messages = newMsgs
}

// MinifyOldToolOutputs replaces verbose tool outputs older than the last
// assistant turn with a short summary to reduce context bloat.
func (h *History) MinifyOldToolOutputs() {
	// Find the index of the most recent assistant message
	lastAssistantIdx := -1
	for i := len(h.messages) - 1; i >= 0; i-- {
		if h.messages[i].Role == "assistant" {
			lastAssistantIdx = i
			break
		}
	}

	for i := 0; i < len(h.messages); i++ {
		m := &h.messages[i]
		if m.Role != "system" {
			continue
		}
		// If this system message is before the last assistant turn AND is large
		if lastAssistantIdx > 0 && i < lastAssistantIdx && len(m.Content) > 300 {
			m.Content = fmt.Sprintf("[Tool output minified: %d bytes]", len(m.Content))
		}
	}
}

// BuildOllamaMessages returns a compacted message list suitable for the LLM.
// It keeps the most recent messages and minifies old tool outputs.
func (h *History) BuildOllamaMessages(maxMessages int) []ollamaMessage {
	h.MinifyOldToolOutputs()

	all := h.OllamaMessages()
	if len(all) <= maxMessages {
		return all
	}
	// Keep the most recent messages
	return all[len(all)-maxMessages:]
}

// OllamaMessages converts the history into the wire format expected by
// the Ollama API, skipping any "Thinking…" placeholder entries.
func (h *History) OllamaMessages() []ollamaMessage {
	out := make([]ollamaMessage, 0, len(h.messages))
	for _, m := range h.messages {
		if m.Content == "Thinking…" {
			continue
		}
		out = append(out, ollamaMessage{Role: m.Role, Content: m.Content})
	}
	return out
}
