package main

import (
	"bufio"
	"fmt"
	"math/rand"
	"os"
	"os/signal"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"syscall"
	"time"
)

func getExecutorPrompt(ws *Workspace, p *ModelProfile) string {
	home, _ := os.UserHomeDir()

	mcpDesc := ""
	if mcpMgr != nil {
		mcpDesc = mcpMgr.ToolDescriptions()
	}

	base := fmt.Sprintf(`### UNIT-01 DIRECTIVE PROTOCOL (NON-NEGOTIABLE) ###
- OPERATING_SYSTEM: %s
- USER_HOME: %s
- CURRENT_WORKSPACE: %s
- ACTIVE_MODEL: %s (%s)
- IDENTITY: You are the UNIT-01 SOVEREIGN ENGINE. You are a native coding orchestrator by Ruthen Labs.

### GROUND TRUTH (PROJECT_MAP & CONTEXT):
%s

### CORE DIRECTIVE:
1. INTERNAL KNOWLEDGE IS DEPRECATED. Use the Ground Truth context provided. It is your only source of reality.
2. You DO have access to the file system. The PROJECT_MAP above IS the real file system.
3. Be concise. Talk is cheap. Show me the code.

### DIRECTIVE TAGS (USE THESE FOR ALL ACTIONS):
- To write a file: <write path="path/to/file">CONTENT</write>
- To execute a command: <execute command="CMD" />
- To list a directory: <indexer_ls path="PATH" />
- To read a file: <indexer_read path="PATH" />
- To search file contents: <search query="pattern" />
- To delete a file: <delete path="PATH" />
- To patch a file: <patch path="PATH" target="OLD" replacement="NEW" />
- To rollback changes: <rollback />

4. If writing code, use the <write> tag.%s`, runtime.GOOS, home, ws.Path, p.Name, p.ParameterSize, ws.ProjectMap, mcpDesc)

	if p.AllowThinking {
		base += "\n\n### THINKING RULES:\n- You MAY use <thinking> tags to plan complex multi-file refactors.\n- Keep thinking concise and focused on code logic."
	} else {
		base += "\n\n### THINKING RULES:\n- YOU MUST NOT use <thinking> tags.\n- YOU MUST ACT AS A PURE MECHANICAL TRANSLATOR.\n- NO CONVERSATION. NO EXPLANATIONS. OUTPUT ONLY CODE."
	}

	return base
}

// ChatLogger persists conversations to .ruthen/chat_history.md
type ChatLogger struct {
	ws *Workspace
	mu sync.Mutex
}

func NewChatLogger(ws *Workspace) *ChatLogger {
	return &ChatLogger{ws: ws}
}

func (cl *ChatLogger) Append(userInput, assistantResponse string) {
	cl.mu.Lock()
	defer cl.mu.Unlock()

	if !cl.ws.Active {
		return
	}

	dir := filepath.Join(cl.ws.Path, ".ruthen")
	os.MkdirAll(dir, 0755)

	path := filepath.Join(dir, "chat_history.md")
	f, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
	if err != nil {
		return
	}
	defer f.Close()

	timestamp := time.Now().UTC().Format(time.RFC3339)
	entry := fmt.Sprintf("## [%s]\n\n**User:** %s\n\n**Assistant:** %s\n\n---\n\n", timestamp, userInput, assistantResponse)
	f.WriteString(entry)
}

// compactHistory replaces the oldest half of history with a model-generated summary
// to keep context usage within the model's window.
func compactHistory(h *History, llm *LLMClient) {
	all := h.All()
	mid := len(all) / 2
	if mid < 2 {
		return
	}

	msgs := make([]ollamaMessage, 0, mid+1)
	msgs = append(msgs, ollamaMessage{
		Role:    "system",
		Content: "Summarize the following conversation history in 2-3 sentences, preserving key technical context and decisions made.",
	})
	for _, m := range all[:mid] {
		msgs = append(msgs, ollamaMessage{Role: m.Role, Content: m.Content})
	}

	summary, err := llm.Chat(msgs)
	if err != nil {
		return
	}

	h.Compact(summary, mid)
}

func main() {
	rand.Seed(time.Now().UnixNano())
	history := &History{}

	// Read model from env or flag — default to qwen2.5-coder:3b
	modelName := os.Getenv("UNIT01_MODEL")
	if modelName == "" {
		modelName = "qwen2.5-coder:3b"
	}
	// Override via --model flag if present
	for i, arg := range os.Args {
		if arg == "--model" && i+1 < len(os.Args) {
			modelName = os.Args[i+1]
			break
		}
	}

	llm := NewLLMClient("", modelName)
	profile := LoadModelProfile(llm)

	daemonMgr := NewDaemonManager()
	ws := NewWorkspace()

	daemonMgr.SpawnIfMissing("indexer", "/tmp/ruthen/indexer.sock")
	daemonMgr.SpawnIfMissing("sandbox", "/tmp/ruthen/sandbox.sock")

	// Initialize MCP servers from ~/.config/unit01/mcp.json
	mcpMgr = LoadMCPConfig()
	if mcpMgr.ToolCount() > 0 {
		fmt.Printf("◆ MCP: %d extensible tool(s) available\n", mcpMgr.ToolCount())
	}

	// SIGTERM/SIGINT handler — clean shutdown of daemons and MCP servers
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGTERM, syscall.SIGINT)
	go func() {
		<-sigCh
		fmt.Println("\n◆ Shutting down...")
		mcpMgr.Shutdown()
		daemonMgr.Shutdown()
		os.Exit(0)
	}()

	cwd, _ := os.Getwd()
	ram := SystemRAMGB()
	fmt.Printf("◆ UNIT-01 SOVEREIGN ENGINE [BOOTED]\n")
	fmt.Printf("◆ Model: %s (%s) | Context: %d | RAM: %dGB\n", profile.Name, profile.ParameterSize, profile.ContextWindow, ram)
	fmt.Printf("◆ Workspace: %s\n", cwd)
	ws.Set(cwd)

	chatLog := NewChatLogger(ws)

	scanner := bufio.NewScanner(os.Stdin)
	for {
		history.PurgeSystemMessages()

		fmt.Printf("\n> ")
		if !scanner.Scan() {
			break
		}
		input := strings.TrimSpace(scanner.Text())
		if input == "" {
			continue
		}

		if input == "/exit" || input == "/quit" {
			fmt.Println("Shutting down...")
			mcpMgr.Shutdown()
			daemonMgr.Shutdown()
			os.Exit(0)
		}

		history.Append(Message{Role: "user", Content: input, Timestamp: time.Now()})

		// ─── PHASE 1: Grammar-constrained directive generation ──────────────
		ws.Refresh()
		autoCtx := getAutoContext(input, ws)
		estimate := history.TokenEstimate()
		threshold := int(float64(profile.ContextWindow) * profile.CompactionPct)
		if estimate > threshold {
			fmt.Printf("◆ Context at ~%d tokens (threshold: %d). Compacting...\n", estimate, threshold)
			compactHistory(history, llm)
		}

		maxRetries := profile.MaxRetries

	directivePhase:
		for retry := 0; retry <= maxRetries; retry++ {
			messages := history.BuildOllamaMessages(profile.MaxMessagesPerTurn)
			prompt := getExecutorPrompt(ws, profile) + autoCtx +
				"\n\n### DIRECTIVE PHASE (JSON STRUCTURED OUTPUT):\n" +
				"Map user requests to directives. NEVER use shell commands (ls, cat, grep, find, mv, cp, mkdir).\n" +
				"- To LIST a directory → indexer_ls with {\"path\":\"...\"}\n" +
				"- To READ a file → indexer_read with {\"path\":\"...\"}\n" +
				"- To READ multiple files at once → read_multiple with {\"paths\":[\"...\",\"...\"]}\n" +
				"- To SEARCH file contents → search with {\"query\":\"...\"}\n" +
				"- To GLOB for files by pattern → glob with {\"pattern\":\"**/*.go\",\"base\":\"...\"}\n" +
				"- To FIND files by name → find with {\"name\":\"...\",\"root\":\"...\"}\n" +
				"- To EXECUTE a command → execute with {\"command\":\"...\"}\n" +
				"- To WRITE a file → write with {\"path\":\"...\",\"content\":\"...\"}\n" +
				"- To APPEND to a file → append with {\"path\":\"...\",\"content\":\"...\"}\n" +
				"- To DELETE a file → delete with {\"path\":\"...\"}\n" +
				"- To PATCH a file → patch with {\"path\":\"...\",\"target\":\"...\",\"replacement\":\"...\"}\n" +
				"- To MOVE/RENAME a file → mv with {\"from\":\"...\",\"to\":\"...\"}\n" +
				"- To COPY a file → cp with {\"from\":\"...\",\"to\":\"...\"}\n" +
				"- To CREATE a directory → mkdir with {\"path\":\"...\"}\n" +
				"- To REMOVE a directory → rmdir with {\"path\":\"...\"}\n" +
				"- To GET file info → file_info with {\"path\":\"...\"}\n" +
				"- To DIFF two files → diff with {\"files\":[\"...\",\"...\"]}\n" +
				"- To VIEW project tree → ls_tree with {\"root\":\"...\"}\n" +
				"- To ROLLBACK changes → rollback with {}\n" +
				"Output ONLY a JSON object with a \"directives\" array. " +
				"Do NOT include any explanation, conversation, or markdown. Only output the JSON object."
			messages = append([]ollamaMessage{{Role: "system", Content: prompt}}, messages...)

			fmt.Print("◆ Planning...")
			directives, _, _, err := llm.StreamDirectives(messages, profile.Temperature)
			if err != nil {
				fmt.Printf(" [Error: %v]\n", err)
				break directivePhase
			}

			if len(directives) == 0 {
				fmt.Println(" [no directives needed]")
				break directivePhase
			}

			fmt.Printf(" [%d directive(s)]\n", len(directives))

			if retry > 0 {
				fmt.Printf("◆ Re-trying directives (attempt %d/%d):\n", retry, maxRetries)
			}

			allOk := true
			for _, dir := range directives {
				result := ExecuteTool(dir.Name, dir.Args, ws)

				display := result
				if len(display) > profile.MaxToolOutputChars {
					display = fmt.Sprintf("[Tool '%s' output truncated: %d bytes]", dir.Name, len(display))
				}

				fmt.Printf("  %s → %s\n", dir.Name, truncateOneLine(display, 80))

		if isToolError(result) {
				allOk = false
				history.Append(Message{
					Role:      "system",
					Content:   fmt.Sprintf("Tool [%s] error (needs correction): %s", dir.Name, result),
					Timestamp: time.Now(),
				})
			} else {
				history.Append(Message{
					Role:      "system",
					Content:   fmt.Sprintf("Tool [%s] completed successfully: %s", dir.Name, result),
					Timestamp: time.Now(),
				})
			}
			}

			if allOk || retry >= maxRetries {
				break directivePhase
			}

			fmt.Printf("◆ Self-correcting (%d/%d)...\n", retry+1, maxRetries)
		}

		// ─── PHASE 2: Free-form response ────────────────────────────────────
		phase2Messages := history.BuildOllamaMessages(profile.MaxMessagesPerTurn)
		prompt := getExecutorPrompt(ws, profile) + autoCtx +
			"\n\n### RESPONSE PHASE:\n" +
			"The directives have been executed. Results are in the conversation history above. " +
			"Now provide your natural language response to the user. Keep it concise."
		phase2Messages = append([]ollamaMessage{{Role: "system", Content: prompt}}, phase2Messages...)

		finalResponse, _, _, _, err := llm.StreamCLI(phase2Messages, os.Stdout, nil, profile.Temperature)
		if err != nil {
			fmt.Printf("\n[Phase 2 Error: %v]\n", err)
			finalResponse = "(error generating response)"
		}

		history.Append(Message{Role: "assistant", Content: finalResponse, Timestamp: time.Now()})

		if finalResponse != "" {
			chatLog.Append(input, finalResponse)
		}
	}
}

func truncateOneLine(s string, maxLen int) string {
	firstLine := s
	if idx := strings.IndexByte(s, '\n'); idx >= 0 {
		firstLine = s[:idx]
	}
	if len(firstLine) > maxLen {
		firstLine = firstLine[:maxLen] + "..."
	}
	return firstLine
}

// isToolError returns true if the tool result indicates a failure.
// Only checks the FIRST LINE of the result to avoid false positives
// from file content that happens to contain "error:" in source code.
func isToolError(result string) bool {
	firstLine := result
	if idx := strings.IndexByte(result, '\n'); idx >= 0 {
		firstLine = result[:idx]
	}
	lower := strings.ToLower(firstLine)
	return strings.HasPrefix(lower, "error") ||
		strings.HasPrefix(lower, "❌")
}
