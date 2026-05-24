package main

import (
	"fmt"
	"os"
	"os/signal"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"syscall"
	"time"

	tea "github.com/charmbracelet/bubbletea"
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

	// SIGTERM handler — clean shutdown of daemons and MCP servers
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGTERM)
	go func() {
		<-sigCh
		mcpMgr.Shutdown()
		daemonMgr.Shutdown()
		os.Exit(0)
	}()

	cwd, _ := os.Getwd()
	ws.Set(cwd)
	chatLog := NewChatLogger(ws)

	ram := SystemRAMGB()
	fmt.Printf("◆ UNIT-01 SOVEREIGN ENGINE [BOOTED]\n")
	fmt.Printf("◆ Model: %s (%s) | Context: %d | RAM: %dGB\n", profile.Name, profile.ParameterSize, profile.ContextWindow, ram)
	fmt.Printf("◆ Workspace: %s\n", cwd)

	// ─── LAUNCH BUBBLE TEA TUI ──────────────────────────────────────────
	p := tea.NewProgram(
		newUIModel(llm, ws, daemonMgr, profile, history, chatLog),
		tea.WithAltScreen(),
		tea.WithMouseCellMotion(),
	)

	if _, err := p.Run(); err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}

	// ─── SHUTDOWN ───────────────────────────────────────────────────────
	mcpMgr.Shutdown()
	daemonMgr.Shutdown()
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
