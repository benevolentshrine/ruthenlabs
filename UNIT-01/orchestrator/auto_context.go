package main

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"unit01/clients"
)

// getAutoContext uses Indexer's semantic/fuzzy search to pre-fetch context based on the raw user input.
func getAutoContext(input string, ws *Workspace) string {
	if !ws.Active {
		return ""
	}

	indexer := clients.NewIndexerClient()
	records, err := indexer.Search(input)
	if err != nil || len(records) == 0 {
		if strings.Contains(strings.ToLower(input), "content") || strings.Contains(strings.ToLower(input), "list") || strings.Contains(strings.ToLower(input), "folder") {
			list, err := indexer.List(ws.Path)
			if err == nil && list != nil && len(list.Entries) > 0 {
				var context strings.Builder
				context.WriteString("\n# DIRECTORY CONTENTS:\n")
				for _, item := range list.Entries {
					context.WriteString(fmt.Sprintf("- [%s] %s\n", item.Type, item.Name))
				}
				return context.String()
			}
		}

		// FALLBACK: Search chat history for relevant past discussions
		chatHistoryCtx := searchChatHistory(input, ws)
		if chatHistoryCtx != "" {
			return chatHistoryCtx
		}
		return ""
	}

	var context strings.Builder
	context.WriteString("\n# IMPLICIT CONTEXT (Pre-fetched based on your request):\n")

	foundCount := 0
	for _, rec := range records {
		fullPath := rec.Path
		if !filepath.IsAbs(rec.Path) {
			fullPath = filepath.Join(ws.Path, rec.Path)
		}

		data, err := os.ReadFile(fullPath)
		if err == nil {
			foundCount++
			content := string(data)
			if len(content) > 2000 {
				content = content[:2000] + "\n... (truncated)"
			}
			context.WriteString(fmt.Sprintf("\n## File: %s\n```\n%s\n```\n", rec.Path, content))
		}
		
		if foundCount >= 3 {
			break
		}
	}

	if foundCount == 0 {
		// Fallback: search chat history
		chatHistoryCtx := searchChatHistory(input, ws)
		if chatHistoryCtx != "" {
			return chatHistoryCtx
		}
		return ""
	}

	return context.String()
}

// searchChatHistory searches .ruthen/chat_history.md for relevant past conversations
// by scanning for recent QA blocks that match the user's input.
func searchChatHistory(input string, ws *Workspace) string {
	if !ws.Active {
		return ""
	}

	chatPath := filepath.Join(ws.Path, ".ruthen", "chat_history.md")
	data, err := os.ReadFile(chatPath)
	if err != nil {
		return ""
	}

	content := string(data)
	// Split into QA blocks separated by ---
	blocks := strings.Split(content, "---")
	if len(blocks) == 0 {
		return ""
	}

	inputLower := strings.ToLower(input)
	var relevantBlocks []string

	for _, block := range blocks {
		block = strings.TrimSpace(block)
		if block == "" {
			continue
		}

		blockLower := strings.ToLower(block)

		// Check if any significant words from the input appear in this block
		inputWords := strings.Fields(inputLower)
		matchCount := 0
		for _, word := range inputWords {
			if len(word) < 4 {
				continue
			}
			if strings.Contains(blockLower, word) {
				matchCount++
			}
		}

		// A match is relevant if at least 2 significant words match
		if matchCount >= 3 {
			relevantBlocks = append(relevantBlocks, block)
		}
	}

	if len(relevantBlocks) == 0 {
		return ""
	}

	// Return up to 3 relevant blocks
	var result strings.Builder
	result.WriteString("\n# IMPLICIT CONTEXT (Past conversation history):\n")
	for i, block := range relevantBlocks {
		if i >= 3 {
			break
		}
		// Truncate long blocks
		if len(block) > 1000 {
			block = block[:1000] + "\n... (truncated)"
		}
		result.WriteString(fmt.Sprintf("\n### Past Discussion:\n%s\n", block))
	}

	return result.String()
}
