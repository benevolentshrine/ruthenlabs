package ruthen

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"os"
	"sync"
	"time"
)

const (
	SandboxSocket  = "/tmp/ruthen/sandbox.sock"
	IndexerSocket  = "/tmp/ruthen/indexer.sock"
	defaultTimeout = 60 * time.Second
)

type jsonRpcRequest struct {
	JsonRPC string         `json:"jsonrpc"`
	ID      uint64         `json:"id"`
	Method  string         `json:"method"`
	Params  map[string]any `json:"params"`
}

type jsonRpcResponse struct {
	JsonRPC string          `json:"jsonrpc"`
	ID      uint64          `json:"id"`
	Result  json.RawMessage `json:"result,omitempty"`
	Error   *jsonRpcError   `json:"error,omitempty"`
}

type jsonRpcError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

type Client struct {
	conn   net.Conn
	reader *bufio.Reader
	mu     sync.Mutex
	nextID uint64
}

func SocketExists(socketPath string) bool {
	_, err := os.Stat(socketPath)
	return err == nil
}

func Dial(socketPath string, timeout time.Duration) (*Client, error) {
	if timeout == 0 {
		timeout = defaultTimeout
	}
	conn, err := net.DialTimeout("unix", socketPath, timeout)
	if err != nil {
		return nil, fmt.Errorf("ruthen: dial %s: %w", socketPath, err)
	}
	return &Client{
		conn:   conn,
		reader: bufio.NewReader(conn),
	}, nil
}

func (c *Client) Close() error {
	return c.conn.Close()
}

func (c *Client) Call(method string, params map[string]any, timeout time.Duration) (json.RawMessage, error) {
	c.mu.Lock()
	c.nextID++
	id := c.nextID
	c.mu.Unlock()

	req := jsonRpcRequest{
		JsonRPC: "2.0",
		ID:      id,
		Method:  method,
		Params:  params,
	}

	if timeout == 0 {
		timeout = defaultTimeout
	}
	_ = c.conn.SetWriteDeadline(time.Now().Add(timeout))

	if err := json.NewEncoder(c.conn).Encode(req); err != nil {
		return nil, fmt.Errorf("ruthen: write request: %w", err)
	}

	_ = c.conn.SetReadDeadline(time.Now().Add(timeout))

	for {
		var resp jsonRpcResponse
		if err := json.NewDecoder(c.reader).Decode(&resp); err != nil {
			return nil, fmt.Errorf("ruthen: read response: %w", err)
		}

		if resp.ID != id {
			continue
		}

		if resp.Error != nil {
			return nil, fmt.Errorf("ruthen: %s (code %d)", resp.Error.Message, resp.Error.Code)
		}

		return resp.Result, nil
	}
}

func (c *Client) CallRaw(method string, params map[string]any, timeout time.Duration) (io.Reader, error) {
	c.mu.Lock()
	c.nextID++
	id := c.nextID
	c.mu.Unlock()

	req := jsonRpcRequest{
		JsonRPC: "2.0",
		ID:      id,
		Method:  method,
		Params:  params,
	}

	if timeout == 0 {
		timeout = defaultTimeout
	}
	_ = c.conn.SetWriteDeadline(time.Now().Add(timeout))

	if err := json.NewEncoder(c.conn).Encode(req); err != nil {
		return nil, fmt.Errorf("ruthen: write request: %w", err)
	}

	return c.reader, nil
}
