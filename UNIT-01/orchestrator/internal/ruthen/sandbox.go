package ruthen

import (
	"bufio"
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

type SandboxClient struct {
	client *Client
}

func NewSandboxClient(timeout time.Duration) (*SandboxClient, error) {
	client, err := Dial(SandboxSocket, timeout)
	if err != nil {
		return nil, err
	}
	return &SandboxClient{client: client}, nil
}

type ExecuteResult struct {
	Stdout   string
	Stderr   string
	ExitCode int
	AuditRef string
}

type ExecuteParams struct {
	Cmd          string
	WorkingDir   string
	AllowNetwork bool
	TimeoutSecs  int
}

func (s *SandboxClient) Execute(params ExecuteParams) (*ExecuteResult, error) {
	rpcParams := map[string]any{
		"cmd": params.Cmd,
	}
	if params.WorkingDir != "" {
		rpcParams["working_dir"] = params.WorkingDir
	}
	if params.AllowNetwork {
		rpcParams["allow_network"] = true
	}
	if params.TimeoutSecs > 0 {
		rpcParams["timeout"] = params.TimeoutSecs
	}

	raw, err := s.client.Call("execute", rpcParams, defaultTimeout)
	if err != nil {
		return nil, err
	}

	var rawResult struct {
		Verdict  string `json:"verdict"`
		AuditRef string `json:"audit_ref"`
	}
	if err := json.Unmarshal(raw, &rawResult); err != nil {
		return nil, fmt.Errorf("ruthen: parse execute result: %w", err)
	}

	result := &ExecuteResult{
		AuditRef: rawResult.AuditRef,
	}

	rawResult.Verdict = strings.TrimPrefix(rawResult.Verdict, "STDOUT:\n")
	parts := strings.SplitN(rawResult.Verdict, "\nSTDERR:\n", 2)
	if len(parts) == 2 {
		result.Stdout = strings.TrimSpace(parts[0])
		result.Stderr = strings.TrimSpace(parts[1])
	} else {
		result.Stdout = strings.TrimSpace(rawResult.Verdict)
	}

	return result, nil
}

func (s *SandboxClient) ExecuteStream(params ExecuteParams) (<-chan StreamEvent, error) {
	rpcParams := map[string]any{
		"cmd": params.Cmd,
	}
	if params.WorkingDir != "" {
		rpcParams["working_dir"] = params.WorkingDir
	}
	if params.AllowNetwork {
		rpcParams["allow_network"] = true
	}
	if params.TimeoutSecs > 0 {
		rpcParams["timeout"] = params.TimeoutSecs
	}

	reader, err := s.client.CallRaw("execute_stream", rpcParams, defaultTimeout)
	if err != nil {
		return nil, err
	}

	events := make(chan StreamEvent, 100)
	go func() {
		defer close(events)
		scanner := bufio.NewScanner(reader)
		for scanner.Scan() {
			line := strings.TrimSpace(scanner.Text())
			if line == "" {
				continue
			}

			var raw struct {
				JsonRPC string          `json:"jsonrpc"`
				ID      uint64          `json:"id"`
				Result  json.RawMessage `json:"result,omitempty"`
				Error   *jsonRpcError   `json:"error,omitempty"`
			}
			if err := json.Unmarshal([]byte(line), &raw); err != nil {
				continue
			}

			if raw.Error != nil {
				events <- StreamEvent{
					Type:  "error",
					Error: fmt.Errorf("%s (code %d)", raw.Error.Message, raw.Error.Code),
				}
				return
			}

			var streamResult struct {
				Type    string `json:"type"`
				Data    string `json:"data,omitempty"`
				Exit    int    `json:"exit,omitempty"`
				AuditID string `json:"audit_id,omitempty"`
			}
			if err := json.Unmarshal(raw.Result, &streamResult); err != nil {
				continue
			}

			switch streamResult.Type {
			case "stdout":
				events <- StreamEvent{Type: "stdout", Data: streamResult.Data}
			case "stderr":
				events <- StreamEvent{Type: "stderr", Data: streamResult.Data}
			case "exit":
				events <- StreamEvent{Type: "exit", ExitCode: streamResult.Exit}
				return
			}
		}
	}()

	return events, nil
}

type StreamEvent struct {
	Type     string
	Data     string
	ExitCode int
	Error    error
}

func (s *SandboxClient) Close() error {
	return s.client.Close()
}
