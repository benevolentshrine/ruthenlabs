package ruthen

import (
	"encoding/json"
	"fmt"
	"time"
)

type IndexerClient struct {
	client *Client
}

func NewIndexerClient(timeout time.Duration) (*IndexerClient, error) {
	client, err := Dial(IndexerSocket, timeout)
	if err != nil {
		return nil, err
	}
	return &IndexerClient{client: client}, nil
}

type ReadResult struct {
	Content string `json:"content"`
}

func (c *IndexerClient) Read(path string) (string, error) {
	raw, err := c.client.Call("read", map[string]any{"path": path}, 0)
	if err != nil {
		return "", err
	}
	var result ReadResult
	if err := json.Unmarshal(raw, &result); err != nil {
		return "", fmt.Errorf("ruthen: parse read result: %w", err)
	}
	return result.Content, nil
}

type WriteResult struct {
	Status string `json:"status"`
}

func (c *IndexerClient) Write(path, content string) error {
	_, err := c.client.Call("write", map[string]any{
		"path":    path,
		"content": content,
	}, 0)
	return err
}

type PatchResult struct {
	Status string `json:"status"`
}

func (c *IndexerClient) Patch(path, target, replacement string) error {
	_, err := c.client.Call("patch", map[string]any{
		"path":        path,
		"target":      target,
		"replacement": replacement,
	}, 0)
	return err
}

type SearchMatch struct {
	Path    string  `json:"path"`
	Line    int     `json:"line"`
	Content string  `json:"content"`
	Score   float64 `json:"score"`
}

type SearchResult struct {
	Results []SearchMatch `json:"results"`
	Count   int           `json:"count"`
}

func (c *IndexerClient) Search(query string, limit int, lang, path string) (*SearchResult, error) {
	params := map[string]any{
		"query": query,
	}
	if limit > 0 {
		params["limit"] = limit
	}
	if lang != "" {
		params["lang"] = lang
	}
	if path != "" {
		params["path"] = path
	}

	raw, err := c.client.Call("search", params, 0)
	if err != nil {
		return nil, err
	}
	var result SearchResult
	if err := json.Unmarshal(raw, &result); err != nil {
		return nil, fmt.Errorf("ruthen: parse search result: %w", err)
	}
	return &result, nil
}

type SemanticSearchResult struct {
	Results []SearchMatch `json:"results"`
	Count   int           `json:"count"`
}

func (c *IndexerClient) SemanticSearch(query string, limit int) (*SemanticSearchResult, error) {
	params := map[string]any{"query": query}
	if limit > 0 {
		params["limit"] = limit
	}

	raw, err := c.client.Call("semantic_search", params, 0)
	if err != nil {
		return nil, err
	}
	var result SemanticSearchResult
	if err := json.Unmarshal(raw, &result); err != nil {
		return nil, fmt.Errorf("ruthen: parse semantic_search result: %w", err)
	}
	return &result, nil
}

type GlobResult struct {
	Files []string `json:"files"`
}

func (c *IndexerClient) Glob(pattern, base string) ([]string, error) {
	params := map[string]any{"pattern": pattern}
	if base != "" {
		params["base"] = base
	}

	raw, err := c.client.Call("glob", params, 0)
	if err != nil {
		return nil, err
	}
	var result GlobResult
	if err := json.Unmarshal(raw, &result); err != nil {
		return nil, fmt.Errorf("ruthen: parse glob result: %w", err)
	}
	return result.Files, nil
}

type DiffLine struct {
	Type string `json:"type"`
	Line int    `json:"line"`
	Text string `json:"text"`
}

type DiffResult struct {
	Files []string   `json:"files"`
	Lines []DiffLine `json:"lines"`
}

func (c *IndexerClient) Diff(files []string) (*DiffResult, error) {
	raw, err := c.client.Call("diff", map[string]any{"files": files}, 0)
	if err != nil {
		return nil, err
	}
	var result DiffResult
	if err := json.Unmarshal(raw, &result); err != nil {
		return nil, fmt.Errorf("ruthen: parse diff result: %w", err)
	}
	return &result, nil
}

type FileInfoResult struct {
	Size     int64 `json:"size"`
	IsDir    bool  `json:"is_dir"`
	Modified int64 `json:"modified"`
}

func (c *IndexerClient) FileInfo(path string) (*FileInfoResult, error) {
	raw, err := c.client.Call("file_info", map[string]any{"path": path}, 0)
	if err != nil {
		return nil, err
	}
	var result FileInfoResult
	if err := json.Unmarshal(raw, &result); err != nil {
		return nil, fmt.Errorf("ruthen: parse file_info result: %w", err)
	}
	return &result, nil
}

type FindResult struct {
	Files []string `json:"files"`
}

func (c *IndexerClient) Find(name, root string) ([]string, error) {
	params := map[string]any{"name": name}
	if root != "" {
		params["root"] = root
	}

	raw, err := c.client.Call("find", params, 0)
	if err != nil {
		return nil, err
	}
	var result FindResult
	if err := json.Unmarshal(raw, &result); err != nil {
		return nil, fmt.Errorf("ruthen: parse find result: %w", err)
	}
	return result.Files, nil
}

func (c *IndexerClient) Dependents(path string) ([]string, error) {
	raw, err := c.client.Call("dependents", map[string]any{"path": path}, 0)
	if err != nil {
		return nil, err
	}
	var result struct {
		Dependents []string `json:"dependents"`
	}
	if err := json.Unmarshal(raw, &result); err != nil {
		return nil, fmt.Errorf("ruthen: parse dependents result: %w", err)
	}
	return result.Dependents, nil
}

func (c *IndexerClient) Dependencies(path string) ([]string, error) {
	raw, err := c.client.Call("dependencies", map[string]any{"path": path}, 0)
	if err != nil {
		return nil, err
	}
	var result struct {
		Dependencies []string `json:"dependencies"`
	}
	if err := json.Unmarshal(raw, &result); err != nil {
		return nil, fmt.Errorf("ruthen: parse dependencies result: %w", err)
	}
	return result.Dependencies, nil
}

func (c *IndexerClient) Impact(path string) (string, error) {
	raw, err := c.client.Call("impact", map[string]any{"path": path}, 0)
	if err != nil {
		return "", err
	}
	var result struct {
		Impact string `json:"impact"`
	}
	if err := json.Unmarshal(raw, &result); err != nil {
		return "", fmt.Errorf("ruthen: parse impact result: %w", err)
	}
	return result.Impact, nil
}

type ShadowEntry struct {
	OriginalPath string `json:"original_path"`
	PathHash     string `json:"path_hash"`
	Timestamp    int64  `json:"timestamp"`
}

type ShadowListResult struct {
	Entries []ShadowEntry `json:"entries"`
	Count   int           `json:"count"`
}

func (c *IndexerClient) ShadowList() (*ShadowListResult, error) {
	raw, err := c.client.Call("shadow_list", nil, 0)
	if err != nil {
		return nil, err
	}
	var result ShadowListResult
	if err := json.Unmarshal(raw, &result); err != nil {
		return nil, fmt.Errorf("ruthen: parse shadow_list result: %w", err)
	}
	return &result, nil
}

type RollbackResult struct {
	Status string `json:"status"`
}

func (c *IndexerClient) Rollback() (*RollbackResult, error) {
	raw, err := c.client.Call("rollback", nil, 0)
	if err != nil {
		return nil, err
	}
	var result RollbackResult
	if err := json.Unmarshal(raw, &result); err != nil {
		return nil, fmt.Errorf("ruthen: parse rollback result: %w", err)
	}
	return &result, nil
}

func (c *IndexerClient) Status() (string, error) {
	raw, err := c.client.Call("status", nil, 0)
	if err != nil {
		return "", err
	}
	var result struct {
		Status string `json:"status"`
	}
	if err := json.Unmarshal(raw, &result); err != nil {
		return "", fmt.Errorf("ruthen: parse status result: %w", err)
	}
	return result.Status, nil
}

func (c *IndexerClient) Close() error {
	return c.client.Close()
}

func (c *IndexerClient) Client() *Client {
	return c.client
}
