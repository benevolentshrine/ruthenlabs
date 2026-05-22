package clients

// IndexerClient wraps UDS for Indexer service.
type IndexerClient struct {
	*UDSClient
}

func NewIndexerClient() *IndexerClient {
	return &IndexerClient{
		NewUDSClient("/tmp/ruthen/indexer.sock"),
	}
}

func (c *IndexerClient) Call(method string, params any, result any) error {
	// Inject the hardcoded UDS trust token
	p, ok := params.(map[string]any)
	if !ok {
		p = make(map[string]any)
		// If it's a different type, we might need more complex logic, 
		// but for UNIT-01 all params are maps.
	}
	p["token"] = "uds-internal-trust"
	return c.UDSClient.Call(method, p, result)
}

type FileRecord struct {
	Path         string `json:"path"`
	RelativePath string `json:"relative_path"`
	Hash         string `json:"hash"`
	Size         uint64 `json:"size_bytes"`
	Language     string `json:"language"`
	Extension    string `json:"extension"`
	IsBinary     bool   `json:"is_binary"`
	Permissions  string `json:"permissions"`
	IndexedAt    string `json:"indexed_at"`
}

func (c *IndexerClient) Search(query string) ([]FileRecord, error) {
	params := map[string]any{"query": query}
	var records []FileRecord
	if err := c.Call("search", params, &records); err != nil {
		return nil, err
	}
	return records, nil
}

func (c *IndexerClient) Read(path string) (string, error) {
	params := map[string]any{"path": path}
	var res struct {
		Content string `json:"content"`
	}
	if err := c.Call("read", params, &res); err != nil {
		return "", err
	}
	return res.Content, nil
}

type ListEntry struct {
	Name string `json:"name"`
	Type string `json:"type"`
}

type ListResult struct {
	Entries []ListEntry `json:"entries"`
}

func (c *IndexerClient) List(path string) (*ListResult, error) {
	params := map[string]any{"path": path}
	var res ListResult
	if err := c.Call("ls", params, &res); err != nil {
		return nil, err
	}
	return &res, nil
}

func (c *IndexerClient) Write(path string, content string) error {
	params := map[string]any{"path": path, "content": content}
	return c.Call("write", params, nil)
}

func (c *IndexerClient) Patch(path string, target string, replacement string) (string, error) {
	params := map[string]any{"path": path, "target": target, "replacement": replacement}
	var res struct {
		Status string `json:"status"`
	}
	if err := c.Call("patch", params, &res); err != nil {
		return "", err
	}
	return res.Status, nil
}

func (c *IndexerClient) Delete(path string) (string, error) {
	params := map[string]any{"path": path}
	var res struct {
		Status string `json:"status"`
	}
	if err := c.Call("delete", params, &res); err != nil {
		return "", err
	}
	return res.Status, nil
}

func (c *IndexerClient) Rollback() (string, error) {
	params := map[string]any{}
	var res struct {
		Status string `json:"status"`
	}
	if err := c.Call("rollback", params, &res); err != nil {
		return "", err
	}
	return res.Status, nil
}

func (c *IndexerClient) GetProjectMap(path string) (string, error) {
	params := map[string]any{"path": path}
	var res struct {
		Map string `json:"map"`
	}
	if err := c.Call("project_map", params, &res); err != nil {
		return "", err
	}
	return res.Map, nil
}

func (c *IndexerClient) Glob(pattern string, base string) ([]string, error) {
	params := map[string]any{"pattern": pattern, "base": base}
	var res struct {
		Files []string `json:"files"`
	}
	if err := c.Call("glob", params, &res); err != nil {
		return nil, err
	}
	return res.Files, nil
}

func (c *IndexerClient) Find(name string, root string) ([]string, error) {
	params := map[string]any{"name": name, "root": root}
	var res struct {
		Files []string `json:"files"`
	}
	if err := c.Call("find", params, &res); err != nil {
		return nil, err
	}
	return res.Files, nil
}

func (c *IndexerClient) Mv(from string, to string) (string, error) {
	params := map[string]any{"from": from, "to": to}
	var res struct {
		Status string `json:"status"`
	}
	if err := c.Call("mv", params, &res); err != nil {
		return "", err
	}
	return res.Status, nil
}

func (c *IndexerClient) Cp(from string, to string) (string, error) {
	params := map[string]any{"from": from, "to": to}
	var res struct {
		Status string `json:"status"`
	}
	if err := c.Call("cp", params, &res); err != nil {
		return "", err
	}
	return res.Status, nil
}

func (c *IndexerClient) Mkdir(path string) (string, error) {
	params := map[string]any{"path": path}
	var res struct {
		Status string `json:"status"`
	}
	if err := c.Call("mkdir", params, &res); err != nil {
		return "", err
	}
	return res.Status, nil
}

func (c *IndexerClient) Rmdir(path string) (string, error) {
	params := map[string]any{"path": path}
	var res struct {
		Status string `json:"status"`
	}
	if err := c.Call("rmdir", params, &res); err != nil {
		return "", err
	}
	return res.Status, nil
}

func (c *IndexerClient) Append(path string, content string) (string, error) {
	params := map[string]any{"path": path, "content": content}
	var res struct {
		Status string `json:"status"`
	}
	if err := c.Call("append", params, &res); err != nil {
		return "", err
	}
	return res.Status, nil
}

type ReadMultipleResult struct {
	Files map[string]string `json:"files"`
}

func (c *IndexerClient) ReadMultiple(paths []string) (*ReadMultipleResult, error) {
	params := map[string]any{"paths": paths}
	var res ReadMultipleResult
	if err := c.Call("read_multiple", params, &res); err != nil {
		return nil, err
	}
	return &res, nil
}

type FileInfo struct {
	Size        int64  `json:"size"`
	IsDir       bool   `json:"is_dir"`
	Permissions uint32 `json:"permissions"`
	Modified    string `json:"modified"`
}

func (c *IndexerClient) FileInfo(path string) (*FileInfo, error) {
	params := map[string]any{"path": path}
	var res FileInfo
	if err := c.Call("file_info", params, &res); err != nil {
		return nil, err
	}
	return &res, nil
}

type DiffLine struct {
	Type   string `json:"type"`   // "same", "added", "removed"
	Number uint   `json:"number"`
	Text   string `json:"text"`
}

type DiffResult struct {
	Files []string   `json:"files"`
	Lines []DiffLine `json:"lines"`
}

func (c *IndexerClient) Diff(files []string) (*DiffResult, error) {
	params := map[string]any{"files": files}
	var res DiffResult
	if err := c.Call("diff", params, &res); err != nil {
		return nil, err
	}
	return &res, nil
}

type TreeEntry struct {
	Name     string       `json:"name"`
	Type     string       `json:"type"`
	Children []TreeEntry  `json:"children,omitempty"`
}

type LsTreeResult struct {
	Root  string      `json:"root"`
	Tree  []TreeEntry `json:"tree"`
}

func (c *IndexerClient) LsTree(root string) (*LsTreeResult, error) {
	params := map[string]any{"root": root}
	var res LsTreeResult
	if err := c.Call("ls_tree", params, &res); err != nil {
		return nil, err
	}
	return &res, nil
}
