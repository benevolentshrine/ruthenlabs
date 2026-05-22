package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"strings"
)

type ollamaChunk struct {
	Model     string      `json:"model"`
	Message   Message     `json:"message"`
	Done      bool        `json:"done"`
	TotalDur  int64       `json:"total_duration"`
	EvalCount int         `json:"eval_count"`
	PromptEvalCount int   `json:"prompt_eval_count"`
}

func ParseStreamCLI(body io.ReadCloser, w io.Writer, stopSpinner func()) (string, []Directive, int, int, error) {
	var fullResponse strings.Builder
	var currentStr string

	scanner := bufio.NewScanner(body)
	scanner.Buffer(make([]byte, 0, 1024*1024), 1024*1024) // 1MB buffer for large outputs
	inThink := false

	for scanner.Scan() {
		var chunk ollamaChunk
		if err := json.Unmarshal(scanner.Bytes(), &chunk); err != nil {
			continue
		}

		tok := chunk.Message.Content
		fullResponse.WriteString(tok)
		currentStr += tok

		if stopSpinner != nil {
			stopSpinner()
		}

		// Handle Thought Process tags (hide them)
		if strings.Contains(tok, "<thinking>") {
			inThink = true
			continue
		}
		if strings.Contains(tok, "</thinking>") {
			inThink = false
			continue
		}

		if !inThink {
			w.Write([]byte(tok))
		}

		if chunk.Done {
			content := fullResponse.String()
			directives := extractDirectives(content)
			return content, directives, chunk.PromptEvalCount, chunk.EvalCount, nil
		}
	}

	if err := scanner.Err(); err != nil {
		return fullResponse.String(), nil, 0, 0, fmt.Errorf("scanner error: %w", err)
	}
	return fullResponse.String(), nil, 0, 0, nil
}

func extractDirectives(content string) []Directive {
	var directives []Directive

	// 1. Parse strict XML-like tags (The "Directive" way)
	// Example: <sandbox_write path="foo.go">content</sandbox_write>
	// Example: <sandbox_exec command="ls" />
	
	lines := strings.Split(content, "\n")
	var inTag bool
	var currentTagName string
	var currentTagArgs map[string]any
	var currentTagContent []string

	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		
		// Self-closing tags: <tool_name arg="val" />
		if strings.HasPrefix(trimmed, "<") && strings.HasSuffix(trimmed, "/>") {
			tagName, args := parseTagLine(trimmed)
			if tagName != "" {
				directives = append(directives, Directive{Name: tagName, Args: args})
			}
			continue
		}

		// Opening tags: <tool_name path="foo.go">
		if strings.HasPrefix(trimmed, "<") && strings.HasSuffix(trimmed, ">") && !strings.HasPrefix(trimmed, "</") {
			tagName, args := parseTagLine(trimmed)
			if tagName != "" {
				inTag = true
				currentTagName = tagName
				currentTagArgs = args
				currentTagContent = nil
			}
			continue
		}

		// Closing tags: </tool_name>
		if inTag && strings.HasPrefix(trimmed, "</"+currentTagName+">") {
			currentTagArgs["content"] = strings.Join(currentTagContent, "\n")
			directives = append(directives, Directive{Name: currentTagName, Args: currentTagArgs})
			inTag = false
			continue
		}

		if inTag {
			currentTagContent = append(currentTagContent, line)
		}
	}

	// 2. Fallback: Parse markdown blocks if no directives were found
	if len(directives) == 0 {
		blocks := parseMarkdownBlocks(content)
		for _, b := range blocks {
			if b.Language == "bash" || b.Language == "sh" {
				directives = append(directives, Directive{Name: "sandbox_exec", Args: map[string]any{"command": b.Content}})
			} else if b.Language != "" {
				// We don't know the path, so we can't easily auto-write markdown blocks yet
				// without more context. We'll leave it for now.
			}
		}
	}

	return directives
}

func parseTagLine(line string) (string, map[string]any) {
	line = strings.Trim(line, "<>/ ")
	parts := strings.Fields(line)
	if len(parts) == 0 {
		return "", nil
	}
	tagName := parts[0]
	args := make(map[string]any)
	for i := 1; i < len(parts); i++ {
		attr := strings.SplitN(parts[i], "=", 2)
		if len(attr) == 2 {
			key := attr[0]
			val := strings.Trim(attr[1], "\"")
			args[key] = val
		}
	}
	return tagName, args
}

type MarkdownBlock struct {
	Language string
	Content  string
}

func parseMarkdownBlocks(content string) []MarkdownBlock {
	var blocks []MarkdownBlock
	lines := strings.Split(content, "\n")
	var inBlock bool
	var currentLang string
	var currentContent []string

	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "```") {
			if inBlock {
				blocks = append(blocks, MarkdownBlock{
					Language: currentLang,
					Content:  strings.Join(currentContent, "\n"),
				})
				inBlock = false
				currentContent = nil
			} else {
				inBlock = true
				currentLang = strings.TrimPrefix(trimmed, "```")
				if currentLang == "sh" {
					currentLang = "bash"
				}
			}
		} else if inBlock {
			currentContent = append(currentContent, line)
		}
	}
	return blocks
}
