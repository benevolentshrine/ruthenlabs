package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"sync"
)

// ─── MCP Config (Claude Code compatible) ───────────────────────────────────────

type MCPConfig struct {
	MCPServers map[string]MCPServerConfig `json:"mcpServers"`
}

type MCPServerConfig struct {
	Command string            `json:"command"`
	Args    []string          `json:"args,omitempty"`
	Env     map[string]string `json:"env,omitempty"`
}

// ─── MCP Protocol Types ────────────────────────────────────────────────────────

type MCPTool struct {
	Name        string      `json:"name"`
	Description string      `json:"description"`
	InputSchema interface{} `json:"inputSchema"`
}

type MCPContentItem struct {
	Type string `json:"type"`
	Text string `json:"text,omitempty"`
}

type MCPToolResult struct {
	Content []MCPContentItem `json:"content"`
	IsError bool             `json:"isError,omitempty"`
}

// ─── JSON-RPC 2.0 over stdio with Content-Length framing ───────────────────────

type mcpRequest struct {
	JSONRPC string `json:"jsonrpc"`
	Method  string `json:"method"`
	Params  any    `json:"params,omitempty"`
	ID      int    `json:"id"`
}

type mcpResponse struct {
	JSONRPC string          `json:"jsonrpc"`
	Result  json.RawMessage `json:"result,omitempty"`
	Error   *mcpRPCError    `json:"error,omitempty"`
	ID      int             `json:"id"`
}

type mcpRPCError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

func (e *mcpRPCError) Error() string {
	return fmt.Sprintf("MCP Error %d: %s", e.Code, e.Message)
}

// ─── MCP Server Instance ───────────────────────────────────────────────────────

type mcpServer struct {
	Name   string
	cmd    *exec.Cmd
	stdin  *bufio.Writer
	stdout *bufio.Scanner
	mu     sync.Mutex
	seqNo  int
}

func newMCPServer(name string, cfg MCPServerConfig) (*mcpServer, error) {
	cmd := exec.Command(cfg.Command, cfg.Args...)
	cmd.Env = os.Environ()
	for k, v := range cfg.Env {
		cmd.Env = append(cmd.Env, k+"="+v)
	}

	stdinPipe, err := cmd.StdinPipe()
	if err != nil {
		return nil, fmt.Errorf("stdin pipe: %w", err)
	}
	stdoutPipe, err := cmd.StdoutPipe()
	if err != nil {
		return nil, fmt.Errorf("stdout pipe: %w", err)
	}
	cmd.Stderr = os.Stderr

	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("start: %w", err)
	}

	s := &mcpServer{
		Name:   name,
		cmd:    cmd,
		stdin:  bufio.NewWriter(stdinPipe),
		stdout: bufio.NewScanner(stdoutPipe),
		seqNo:  0,
	}
	s.stdout.Buffer(make([]byte, 0, 64*1024), 10*1024*1024)
	s.stdout.Split(scanMCPFrame)

	return s, nil
}

// scanMCPFrame splits on Content-Length: N\r\n\r\n<JSON>\n
func scanMCPFrame(data []byte, atEOF bool) (advance int, token []byte, err error) {
	headerEnd := strings.Index(string(data), "\r\n\r\n")
	if headerEnd == -1 {
		if atEOF {
			return 0, data, bufio.ErrFinalToken
		}
		return 0, nil, nil
	}

	var contentLen int
	for _, line := range strings.Split(string(data[:headerEnd]), "\r\n") {
		if strings.HasPrefix(line, "Content-Length: ") {
			fmt.Sscanf(line, "Content-Length: %d", &contentLen)
		}
	}

	bodyStart := headerEnd + 4
	if len(data) < bodyStart+contentLen {
		return 0, nil, nil
	}

	return bodyStart + contentLen, data[bodyStart : bodyStart+contentLen], nil
}

func (s *mcpServer) roundTrip(method string, params any) (json.RawMessage, error) {
	s.mu.Lock()
	s.seqNo++
	id := s.seqNo
	s.mu.Unlock()

	req := mcpRequest{
		JSONRPC: "2.0",
		Method:  method,
		Params:  params,
		ID:      id,
	}

	data, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("marshal: %w", err)
	}

	msg := fmt.Sprintf("Content-Length: %d\r\n\r\n%s", len(data), data)
	if _, err := s.stdin.WriteString(msg); err != nil {
		return nil, fmt.Errorf("write: %w", err)
	}
	s.stdin.Flush()

	for s.stdout.Scan() {
		var resp mcpResponse
		if err := json.Unmarshal(s.stdout.Bytes(), &resp); err != nil {
			return nil, fmt.Errorf("unmarshal: %w", err)
		}
		if resp.ID == id {
			if resp.Error != nil {
				return nil, resp.Error
			}
			return resp.Result, nil
		}
		// Non-matching ID = server notification, discard
	}
	if err := s.stdout.Err(); err != nil {
		return nil, fmt.Errorf("read: %w", err)
	}
	return nil, fmt.Errorf("server %s closed connection", s.Name)
}

func (s *mcpServer) initialize() error {
	params := map[string]any{
		"protocolVersion": "2024-11-05",
		"capabilities":    map[string]any{},
		"clientInfo": map[string]string{
			"name":    "unit01",
			"version": "1.0",
		},
	}
	_, err := s.roundTrip("initialize", params)
	return err
}

func (s *mcpServer) listTools() ([]MCPTool, error) {
	result, err := s.roundTrip("tools/list", nil)
	if err != nil {
		return nil, err
	}
	var list struct {
		Tools []MCPTool `json:"tools"`
	}
	if err := json.Unmarshal(result, &list); err != nil {
		return nil, fmt.Errorf("unmarshal tools: %w", err)
	}
	return list.Tools, nil
}

func (s *mcpServer) callTool(name string, args map[string]any) (*MCPToolResult, error) {
	params := map[string]any{
		"name":      name,
		"arguments": args,
	}
	result, err := s.roundTrip("tools/call", params)
	if err != nil {
		return nil, err
	}
	var toolResult MCPToolResult
	if err := json.Unmarshal(result, &toolResult); err != nil {
		return nil, fmt.Errorf("unmarshal result: %w", err)
	}
	return &toolResult, nil
}

func (s *mcpServer) shutdown() {
	s.cmd.Process.Kill()
	s.cmd.Wait()
}

// ─── MCP Manager ───────────────────────────────────────────────────────────────

type MCPManager struct {
	servers map[string]*mcpServer
	tools   map[string]mcpToolRef
}

type mcpToolRef struct {
	ServerName string
	Tool       MCPTool
}

// LoadMCPConfig reads ~/.config/unit01/mcp.json and starts all MCP servers.
// Missing config file is not an error — returns an empty manager.
func LoadMCPConfig() *MCPManager {
	mgr := &MCPManager{
		servers: make(map[string]*mcpServer),
		tools:   make(map[string]mcpToolRef),
	}

	home, err := os.UserHomeDir()
	if err != nil {
		return mgr
	}
	configPath := home + "/.config/unit01/mcp.json"

	data, err := os.ReadFile(configPath)
	if err != nil {
		if os.IsNotExist(err) {
			fmt.Println("◆ MCP: no config at ~/.config/unit01/mcp.json, skipping")
		}
		return mgr
	}

	var cfg MCPConfig
	if err := json.Unmarshal(data, &cfg); err != nil {
		fmt.Printf("⚠️ MCP config parse error: %v\n", err)
		return mgr
	}

	for name, srvCfg := range cfg.MCPServers {
		server, err := newMCPServer(name, srvCfg)
		if err != nil {
			fmt.Printf("⚠️ MCP [%s] start failed: %v\n", name, err)
			continue
		}
		if err := server.initialize(); err != nil {
			fmt.Printf("⚠️ MCP [%s] init failed: %v\n", name, err)
			server.shutdown()
			continue
		}
		tools, err := server.listTools()
		if err != nil {
			fmt.Printf("⚠️ MCP [%s] list_tools failed: %v\n", name, err)
			server.shutdown()
			continue
		}

		mgr.servers[name] = server
		for _, tool := range tools {
			mgr.tools[tool.Name] = mcpToolRef{
				ServerName: name,
				Tool:       tool,
			}
		}
		fmt.Printf("◆ MCP [%s] loaded (%d tools)\n", name, len(tools))
	}

	return mgr
}

// ToolCount returns the number of registered MCP tools.
func (m *MCPManager) ToolCount() int {
	return len(m.tools)
}

// ToolDescriptions returns a string listing all MCP tools for prompt injection.
func (m *MCPManager) ToolDescriptions() string {
	if len(m.tools) == 0 {
		return ""
	}
	var b strings.Builder
	b.WriteString("\n\n### MCP EXTENSIBLE TOOLS (available on this system):\n")
	for _, ref := range m.tools {
		b.WriteString(fmt.Sprintf("- <%s>", ref.Tool.Name))
		if ref.Tool.Description != "" {
			b.WriteString(": " + ref.Tool.Description)
		}
		b.WriteString("\n")
	}
	b.WriteString("Use these with the same <tool_name arg=\"val\" /> syntax as the directive tags above.")
	return b.String()
}

// ExecuteMCPTool routes a tool call to the correct MCP server.
// Returns empty string if the tool is not found.
func (m *MCPManager) ExecuteMCPTool(name string, args map[string]any) string {
	ref, ok := m.tools[name]
	if !ok {
		return ""
	}
	server, ok := m.servers[ref.ServerName]
	if !ok {
		return ""
	}
	result, err := server.callTool(name, args)
	if err != nil {
		return fmt.Sprintf("❌ MCP Error (%s): %v", name, err)
	}
	var sb strings.Builder
	for _, item := range result.Content {
		sb.WriteString(item.Text)
	}
	return sb.String()
}

// HasTool checks if an MCP tool with the given name exists.
func (m *MCPManager) HasTool(name string) bool {
	_, ok := m.tools[name]
	return ok
}

// Shutdown kills all MCP server processes.
func (m *MCPManager) Shutdown() {
	for name, s := range m.servers {
		s.shutdown()
		fmt.Printf("◆ MCP [%s] stopped\n", name)
	}
}
