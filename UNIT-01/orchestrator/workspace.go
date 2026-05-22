package main

import (
	"fmt"
	"os"
	"path/filepath"
	"unit01/clients"
)

// Workspace tracks the active working directory and session state.
type Workspace struct {
	Path         string
	SessionID    string
	ProjectMap   string
	Instructions string
	Identity     string
	Active       bool
}

func NewWorkspace() *Workspace {
	return &Workspace{}
}

// Set activates a workspace at the given path.
func (w *Workspace) Set(path string) (string, error) {
	client := clients.NewSandboxClient()
	sessionID, err := client.SetWorkspace(path)
	if err != nil {
		w.Path = path
		w.SessionID = "local"
		w.Active = true
		return "local", nil
	}
	w.Path = path
	w.SessionID = sessionID
	w.Active = true

	indexer := clients.NewIndexerClient()
	if m, err := indexer.GetProjectMap(path); err == nil {
		w.ProjectMap = m
	}

	if data, err := os.ReadFile(filepath.Join(path, "UNIT-01.md")); err == nil {
		w.Instructions = string(data)
	}

	identity := ""
	if data, err := os.ReadFile(filepath.Join(path, "go.mod")); err == nil {
		identity += "--- GO.MOD ---\n" + string(data) + "\n"
	}
	if data, err := os.ReadFile(filepath.Join(path, "README.md")); err == nil {
		content := string(data)
		if len(content) > 1000 {
			content = content[:1000] + "... (truncated)"
		}
		identity += "--- README.MD ---\n" + content + "\n"
	}
	w.Identity = identity

	return sessionID, nil
}

func (w *Workspace) Refresh() {
	if !w.Active {
		return
	}
	indexer := clients.NewIndexerClient()
	m, err := indexer.GetProjectMap(w.Path)
	if err != nil {
		w.ProjectMap = fmt.Sprintf("[Indexer Error: failed to fetch project map: %v]", err)
	} else if m == "" {
		w.ProjectMap = "[Indexer Error: project map returned empty string]"
	} else {
		w.ProjectMap = m
	}
}


