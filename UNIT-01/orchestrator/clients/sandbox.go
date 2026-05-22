package clients

// SandboxClient wraps UDS for Sandbox service (execution only).
// File operations (write, patch, delete, rollback) are handled by the Indexer client.
type SandboxClient struct {
	*UDSClient
}

func NewSandboxClient() *SandboxClient {
	return &SandboxClient{
		NewUDSClient("/tmp/ruthen/sandbox.sock"),
	}
}

func (c *SandboxClient) Execute(cmd string) (string, error) {
	params := map[string]any{"cmd": cmd, "cwd": "."}
	var res struct {
		Verdict string `json:"verdict"`
		Stdout  string `json:"stdout"`
	}
	if err := c.Call("execute", params, &res); err != nil {
		return "", err
	}
	if res.Stdout != "" {
		return res.Stdout, nil
	}
	return res.Verdict, nil
}

// SetWorkspace tells Sandbox the active directory for execution scoping.
func (c *SandboxClient) SetWorkspace(path string) (string, error) {
	params := map[string]any{"path": path}
	var res struct {
		Verdict  string `json:"verdict"`
		AuditRef string `json:"audit_ref"`
	}
	if err := c.Call("set_workspace", params, &res); err != nil {
		return "", err
	}
	return res.AuditRef, nil
}
