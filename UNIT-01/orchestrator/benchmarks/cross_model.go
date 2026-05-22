package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"strings"
	"time"
)

type modelTest struct {
	Name        string
	ParamSize   string
	SchemaScore int
	KeyUsed     string
	ChainMax    int
	Fidelity    bool
	Corrected   bool
}

var directiveSchema = map[string]interface{}{
	"type": "object",
	"properties": map[string]interface{}{
		"directives": map[string]interface{}{
			"type": "array",
			"items": map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"name": map[string]interface{}{
						"type": "string",
						"enum": []string{
							"indexer_ls", "indexer_read", "search", "execute",
							"write", "delete", "patch", "rollback",
							"glob", "find", "mv", "cp", "mkdir", "rmdir",
							"append", "read_multiple", "file_info", "diff", "ls_tree",
						},
					},
					"args": map[string]interface{}{
						"type":                 "object",
						"additionalProperties": false,
						"properties": map[string]interface{}{
							"path":        map[string]interface{}{"type": "string"},
							"content":     map[string]interface{}{"type": "string"},
							"target":      map[string]interface{}{"type": "string"},
							"replacement": map[string]interface{}{"type": "string"},
							"command":     map[string]interface{}{"type": "string"},
							"pattern":     map[string]interface{}{"type": "string"},
							"base":        map[string]interface{}{"type": "string"},
							"name":        map[string]interface{}{"type": "string"},
							"root":        map[string]interface{}{"type": "string"},
							"from":        map[string]interface{}{"type": "string"},
							"to":          map[string]interface{}{"type": "string"},
							"query":       map[string]interface{}{"type": "string"},
							"files":       map[string]interface{}{"type": "array", "items": map[string]interface{}{"type": "string"}},
							"paths":       map[string]interface{}{"type": "array", "items": map[string]interface{}{"type": "string"}},
						},
					},
				},
				"required": []string{"name", "args"},
			},
		},
	},
	"required": []string{"directives"},
}

var httpClient = &http.Client{Timeout: 120 * time.Second}

type ollamaMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type directiveResult struct {
	Directives []struct {
		Name string                 `json:"name"`
		Args map[string]interface{} `json:"args"`
	} `json:"directives"`
}

var validDirectives = map[string]bool{
	"indexer_ls": true, "indexer_read": true, "search": true, "execute": true,
	"write": true, "delete": true, "patch": true, "rollback": true,
	"glob": true, "find": true, "mv": true, "cp": true, "mkdir": true, "rmdir": true,
	"append": true, "read_multiple": true, "file_info": true, "diff": true, "ls_tree": true,
}

func getParamSize(model string) string {
	out, err := exec.Command("ollama", "show", model).Output()
	if err != nil {
		return "?"
	}
	for _, line := range strings.Split(string(out), "\n") {
		if strings.Contains(line, "Parameter Size") || strings.Contains(line, "parameter_size") {
			parts := strings.Split(line, ":")
			if len(parts) >= 2 {
				return strings.TrimSpace(parts[len(parts)-1])
			}
		}
	}
	return "?"
}

func ollamaChat(model string, messages []ollamaMessage, schema interface{}) (string, error) {
	body := map[string]interface{}{
		"model":    model,
		"messages": messages,
		"stream":   false,
		"options":  map[string]interface{}{"temperature": 0.0},
	}
	if schema != nil {
		body["format"] = schema
	}

	b, _ := json.Marshal(body)
	resp, err := httpClient.Post("http://127.0.0.1:11434/api/chat", "application/json", bytes.NewReader(b))
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	var chatResp struct {
		Message struct {
			Content string `json:"content"`
		} `json:"message"`
		Error string `json:"error,omitempty"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&chatResp); err != nil {
		return "", err
	}
	if chatResp.Error != "" {
		return "", fmt.Errorf("ollama error: %s", chatResp.Error)
	}
	return chatResp.Message.Content, nil
}

func withTimeout(label string, fn func() (string, error)) (string, error) {
	type result struct {
		s   string
		err error
	}
	ch := make(chan result, 1)
	go func() {
		s, err := fn()
		ch <- result{s, err}
	}()
	select {
	case r := <-ch:
		return r.s, r.err
	case <-time.After(120 * time.Second):
		return "", fmt.Errorf("timeout after 120s")
	}
}

func testSchemaCompliance(model string) (int, string) {
	messages := []ollamaMessage{
		{Role: "user", Content: "list all .go files in the current directory"},
	}
	out, err := withTimeout("schema", func() (string, error) {
		return ollamaChat(model, messages, directiveSchema)
	})
	if err != nil {
		return 0, fmt.Sprintf("error: %v", err)
	}

	var result directiveResult
	if err := json.Unmarshal([]byte(out), &result); err != nil {
		return 0, fmt.Sprintf("parse error: %v", err)
	}
	if len(result.Directives) == 0 {
		return 0, "empty directives"
	}

	valid := 0
	for _, d := range result.Directives {
		if validDirectives[d.Name] {
			valid++
		}
	}
	score := valid * 100 / len(result.Directives)
	detail := fmt.Sprintf("valid=%d/%d", valid, len(result.Directives))
	if len(result.Directives) > 0 {
		detail += fmt.Sprintf(", first=%s", result.Directives[0].Name)
	}
	return score, detail
}

func parseDirectives(out string) (directiveResult, error) {
	var result directiveResult
	// Try direct parse first
	if err := json.Unmarshal([]byte(out), &result); err == nil {
		return result, nil
	}
	// Some models wrap in markdown
	if idx := strings.Index(out, "{"); idx >= 0 {
		cleaned := out[idx:]
		if end := strings.LastIndex(cleaned, "}"); end >= 0 {
			cleaned = cleaned[:end+1]
			if err := json.Unmarshal([]byte(cleaned), &result); err == nil {
				return result, nil
			}
		}
	}
	return result, fmt.Errorf("cannot parse: %s", out[:min(len(out), 200)])
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func testKeyMapping(model string) (string, string) {
	messages := []ollamaMessage{
		{Role: "user", Content: `write a file called "/tmp/unit01_bench_key_test.txt" with content "hello benchmark"`},
	}
	out, err := withTimeout("keymap", func() (string, error) {
		return ollamaChat(model, messages, directiveSchema)
	})
	if err != nil {
		return "", fmt.Sprintf("error: %v", err)
	}

	result, err := parseDirectives(out)
	if err != nil {
		return "", fmt.Sprintf("parse: %v", err)
	}
	if len(result.Directives) == 0 {
		return "", "no directives"
	}

	d := result.Directives[0]
	if d.Name != "write" {
		return "", fmt.Sprintf("not write: %s", d.Name)
	}

	contentKeys := []string{"content", "target", "content_data", "data", "text", "body", "html", "code"}
	for _, k := range contentKeys {
		if _, ok := d.Args[k]; ok {
			return k, fmt.Sprintf("key=%s", k)
		}
	}
	return "unknown", fmt.Sprintf("keys: %v", mapKeys(d.Args))
}

func mapKeys(m map[string]interface{}) []string {
	var keys []string
	for k := range m {
		keys = append(keys, k)
	}
	return keys
}

func testChaining(model string) (int, string) {
	msg := `create 5 files in /tmp/unit01_chain/ named f1.txt through f5.txt, each containing their respective number (1-5) as content`
	messages := []ollamaMessage{
		{Role: "user", Content: msg},
	}
	out, err := withTimeout("chain", func() (string, error) {
		return ollamaChat(model, messages, directiveSchema)
	})
	if err != nil {
		return 0, fmt.Sprintf("error: %v", err)
	}

	result, err := parseDirectives(out)
	if err != nil {
		return 0, fmt.Sprintf("parse: %v", err)
	}

	writes := 0
	for _, d := range result.Directives {
		if d.Name == "write" {
			writes++
		}
	}
	return writes, fmt.Sprintf("%d writes in %d", writes, len(result.Directives))
}

func testFidelity(model string) (bool, string) {
	payload := fmt.Sprintf("bench_payload_%d", time.Now().UnixNano())
	path := "/tmp/unit01_bench_fidelity.txt"
	messages := []ollamaMessage{
		{Role: "user", Content: fmt.Sprintf(`write a file at "%s" with content "%s"`, path, payload)},
	}
	out, err := withTimeout("fidelity", func() (string, error) {
		return ollamaChat(model, messages, directiveSchema)
	})
	if err != nil {
		return false, fmt.Sprintf("error: %v", err)
	}

	result, err := parseDirectives(out)
	if err != nil {
		return false, fmt.Sprintf("parse: %v", err)
	}
	if len(result.Directives) == 0 {
		return false, "no directives"
	}

	d := result.Directives[0]
	if d.Name != "write" {
		return false, fmt.Sprintf("not write: %s", d.Name)
	}

	var writtenContent string
	if c, ok := d.Args["content"].(string); ok {
		writtenContent = c
	} else if c, ok := d.Args["target"].(string); ok {
		writtenContent = c
	}
	if writtenContent == "" {
		return false, "no content key"
	}

	writtenContent = strings.ReplaceAll(writtenContent, "\\n", "\n")
	return writtenContent == payload, fmt.Sprintf("expect=%q got=%q", payload, writtenContent)
}

func testSelfCorrection(model string) (bool, string) {
	messages := []ollamaMessage{
		{Role: "user", Content: `execute command "this_command_does_not_exist_xyz"`},
	}
	out, err := withTimeout("correct1", func() (string, error) {
		return ollamaChat(model, messages, directiveSchema)
	})
	if err != nil {
		return false, fmt.Sprintf("error: %v", err)
	}

	result, err := parseDirectives(out)
	if err != nil {
		return false, fmt.Sprintf("parse: %v", err)
	}
	if len(result.Directives) == 0 {
		return false, "no directives"
	}

	hasExecute := false
	for _, d := range result.Directives {
		if d.Name == "execute" {
			hasExecute = true
			break
		}
	}
	if !hasExecute {
		return false, "no execute directive"
	}

	messages2 := []ollamaMessage{
		{Role: "user", Content: `the previous command failed with "command not found". try "echo" or "ls" instead`},
		{Role: "assistant", Content: out},
	}
	out2, err := withTimeout("correct2", func() (string, error) {
		return ollamaChat(model, messages2, directiveSchema)
	})
	if err != nil {
		return false, fmt.Sprintf("retry error: %v", err)
	}

	result2, err := parseDirectives(out2)
	if err != nil {
		return false, fmt.Sprintf("retry parse: %v", err)
	}

	for _, d := range result2.Directives {
		if d.Name == "execute" {
			if cmd, ok := d.Args["command"].(string); ok {
				if strings.Contains(cmd, "echo") || strings.Contains(cmd, "ls") || strings.Contains(cmd, "pwd") {
					return true, fmt.Sprintf("corrected to: %s", cmd)
				}
			}
		}
	}
	return false, "no valid correction"
}

func detectModels() ([]modelTest, error) {
	out, err := exec.Command("ollama", "list").Output()
	if err != nil {
		return nil, fmt.Errorf("ollama not found: %w", err)
	}

	type modelInfo struct{ name string }
	var models []modelInfo
	for _, line := range strings.Split(string(out), "\n")[1:] {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) >= 1 {
			name := fields[0]
			if !strings.Contains(name, ":latest") {
				models = append(models, modelInfo{name: name})
			}
		}
	}
	if len(models) == 0 {
		return nil, fmt.Errorf("no models found")
	}

	preferred := []string{
		"qwen2.5-coder:0.5b", "qwen2.5-coder:1.5b", "qwen3.5:2b",
		"qwen2.5-coder:3b", "qwen2.5-coder:7b", "qwen3-coder:8b", "qwen2.5-coder:14b",
		"deepseek-coder:6.7b", "deepseek-r1:7b", "deepseek-r1:14b", "deepseek-coder-v2:16b",
		"llama3.2:1b", "llama3.2:3b", "llama3.1:8b", "llama4:scout",
		"gemma3:1b", "gemma3:4b", "gemma3:12b", "gemma4:8b", "gemma4:26b", "gemma4:31b-cloud",
		"mistral:7b", "mistral-nemo:12b",
		"phi4:14b", "phi4-mini:3.8b",
		"codestral:22b",
	}

	avail := make(map[string]bool)
	for _, m := range models {
		avail[m.name] = true
	}

	var results []modelTest
	for _, name := range preferred {
		if avail[name] {
			results = append(results, modelTest{Name: name, ParamSize: "?"})
		}
	}
	for _, m := range models {
		found := false
		for _, p := range preferred {
			if m.name == p {
				found = true
				break
			}
		}
		if !found {
			results = append(results, modelTest{Name: m.name, ParamSize: "?"})
		}
	}

	for i := range results {
		results[i].ParamSize = getParamSize(results[i].Name)
	}

	return results, nil
}

func main() {
	fmt.Println("╔══════════════════════════════════════════════════════════════════╗")
	fmt.Println("║     UNIT-01 CROSS-MODEL BENCHMARK                              ║")
	fmt.Println("╚══════════════════════════════════════════════════════════════════╝")
	fmt.Println()

	models, err := detectModels()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}

	fmt.Printf("Detected %d models:\n", len(models))
	for _, m := range models {
		fmt.Printf("  %s (%s)\n", m.Name, m.ParamSize)
	}
	fmt.Println()

	_ = os.MkdirAll("/tmp/unit01_chain", 0755)
	os.Remove("/tmp/unit01_bench_key_test.txt")
	os.Remove("/tmp/unit01_bench_fidelity.txt")

	for i := range models {
		m := &models[i]
		fmt.Printf("─── Testing: %s (%s) ───\n", m.Name, m.ParamSize)

		start := time.Now()

		fmt.Print("  Schema compliance... ")
		score, detail := testSchemaCompliance(m.Name)
		m.SchemaScore = score
		fmt.Printf("%d%% (%s)\n", score, detail)

		fmt.Print("  Key mapping....... ")
		key, detail := testKeyMapping(m.Name)
		m.KeyUsed = key
		fmt.Printf("%s (%s)\n", key, detail)

		fmt.Print("  Chaining limit.... ")
		max, detail := testChaining(m.Name)
		m.ChainMax = max
		fmt.Printf("%d (%s)\n", max, detail)

		fmt.Print("  Disk fidelity..... ")
		ok, detail := testFidelity(m.Name)
		m.Fidelity = ok
		if ok {
			fmt.Printf("✓ (%s)\n", detail)
		} else {
			fmt.Printf("✗ (%s)\n", detail)
		}

		fmt.Print("  Self-correction... ")
		ok, detail = testSelfCorrection(m.Name)
		m.Corrected = ok
		if ok {
			fmt.Printf("✓ (%s)\n", detail)
		} else {
			fmt.Printf("✗ (%s)\n", detail)
		}

		fmt.Printf("  ⏱ %s\n", time.Since(start).Round(time.Second))
		fmt.Println()
	}

	fmt.Println("╔══════════════════════════════════════════════════════════════════╗")
	fmt.Println("║     RESULTS                                                    ║")
	fmt.Println("╚══════════════════════════════════════════════════════════════════╝")
	fmt.Println()
	fmt.Printf("%-30s %-8s %-6s %-10s %-6s %-10s %-8s\n",
		"Model", "Params", "Schema", "Key", "Chain", "Fidelity", "Correct")
	fmt.Println(strings.Repeat("─", 85))
	for _, m := range models {
		fid := "✗"
		if m.Fidelity {
			fid = "✓"
		}
		cor := "✗"
		if m.Corrected {
			cor = "✓"
		}
		fmt.Printf("%-30s %-8s %-6s %-10s %-6d %-10s %-8s\n",
			m.Name, m.ParamSize, fmt.Sprintf("%d%%", m.SchemaScore), m.KeyUsed, m.ChainMax, fid, cor)
	}
	fmt.Println()
	fmt.Println("  Schema: % of directive names in valid enum")
	fmt.Println("  Key:    arg key used for file content")
	fmt.Println("  Chain:  max write directives in one response")
	fmt.Println("  Fidelity: content matches what was requested")
	fmt.Println("  Correct: error recovery with valid alternative")
	fmt.Println()
}
