package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/charmbracelet/huh"
	"github.com/charmbracelet/lipgloss"
)

type SessionMeta struct {
	ID          string    `json:"id"`
	Name        string    `json:"name"`
	LastUpdated time.Time `json:"last_updated"`
}

type SessionData struct {
	SessionMeta
	History []Message `json:"history"`
}

func getSessionsDir() string {
	home, _ := os.UserHomeDir()
	dir := filepath.Join(home, ".ruthen", "unit01", "sessions")
	os.MkdirAll(dir, 0755)
	return dir
}

func SaveSession(id string, name string, history *History) error {
	if id == "" {
		return nil
	}
	dir := getSessionsDir()
	path := filepath.Join(dir, id+".json")

	data := SessionData{
		SessionMeta: SessionMeta{
			ID:          id,
			Name:        name,
			LastUpdated: time.Now(),
		},
		History: history.messages,
	}

	b, err := json.MarshalIndent(data, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, b, 0644)
}

func LoadSession(id string, history *History) (string, error) {
	dir := getSessionsDir()
	path := filepath.Join(dir, id+".json")

	b, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}

	var data SessionData
	if err := json.Unmarshal(b, &data); err != nil {
		return "", err
	}

	history.messages = data.History
	return data.Name, nil
}

func HandleSessionsMenu(history *History) string {
	dir := getSessionsDir()
	entries, err := os.ReadDir(dir)
	if err != nil {
		fmt.Println("No sessions found.")
		return ""
	}

	var sessions []SessionMeta
	for _, e := range entries {
		if strings.HasSuffix(e.Name(), ".json") {
			b, err := os.ReadFile(filepath.Join(dir, e.Name()))
			if err == nil {
				var meta SessionMeta
				if json.Unmarshal(b, &meta) == nil {
					sessions = append(sessions, meta)
				}
			}
		}
	}

	sort.Slice(sessions, func(i, j int) bool {
		return sessions[i].LastUpdated.After(sessions[j].LastUpdated)
	})

	var options []huh.Option[string]
	options = append(options, huh.NewOption(lipgloss.NewStyle().Foreground(BrandColor).Render("+ Start New Session"), "new"))

	for _, s := range sessions {
		timeStr := s.LastUpdated.Format("Jan 02, 3:04 PM")
		label := fmt.Sprintf("▣ %-30s (%s)", s.Name, timeStr)
		options = append(options, huh.NewOption(label, s.ID))
	}

	var selectedID string
	formErr := huh.NewSelect[string]().
		Title("Resume a Past Session").
		Options(options...).
		Value(&selectedID).
		Run()

	if formErr != nil {
		return ""
	}

	return selectedID
}
