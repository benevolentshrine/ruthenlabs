package main

import (
	"fmt"
	"strings"

	"github.com/charmbracelet/huh"
	"github.com/charmbracelet/lipgloss"
)

type ReviewAction int

const (
	ReviewApprove ReviewAction = iota
	ReviewReject
	ReviewSuggest
)

type ReviewResult struct {
	Action     ReviewAction
	Suggestion string
}

func ShowCodePreview(path, content, language string) ReviewResult {
	width := 80

	preview := content
	lineCount := strings.Count(content, "\n") + 1
	if lineCount > 60 {
		lines := strings.SplitN(content, "\n", 61)
		preview = strings.Join(lines[:60], "\n") + fmt.Sprintf("\n... (%d more lines)", lineCount-60)
	}

	headerStyle := lipgloss.NewStyle().
		Bold(true).
		Foreground(lipgloss.Color("#000000")).
		Background(BrandColor).
		Padding(0, 1).
		Width(width - 4)

	header := headerStyle.Render(fmt.Sprintf("📄 %s  (%d lines, %s)", path, lineCount, language))

	codeStyle := lipgloss.NewStyle().
		Foreground(lipgloss.Color("#E0E0E0")).
		Background(lipgloss.Color("#1E1E2E")).
		Padding(1, 2).
		Width(width - 4)

	codeBlock := codeStyle.Render(preview)

	containerStyle := lipgloss.NewStyle().
		BorderStyle(lipgloss.RoundedBorder()).
		BorderForeground(BrandColor).
		Width(width - 2).
		Padding(0, 0)

	fmt.Println()
	fmt.Println(containerStyle.Render(header + "\n" + codeBlock))

	var choice int
	selector := huh.NewSelect[int]().
		Title("What do you want to do?").
		Options(
			huh.NewOption("✅ Approve — write to disk", 0),
			huh.NewOption("❌ Reject — discard", 1),
			huh.NewOption("✏️  Suggest Changes — tell the model what to fix", 2),
		).
		Value(&choice)

	form := huh.NewForm(huh.NewGroup(selector))
	if err := form.Run(); err != nil {
		return ReviewResult{Action: ReviewReject}
	}

	switch choice {
	case 0:
		return ReviewResult{Action: ReviewApprove}
	case 1:
		return ReviewResult{Action: ReviewReject}
	case 2:
		var suggestion string
		input := huh.NewInput().
			Title("What should the model change?").
			Value(&suggestion).
			Placeholder("e.g., add error handling, use a different color scheme...")

		suggestionForm := huh.NewForm(huh.NewGroup(input))
		if err := suggestionForm.Run(); err != nil || suggestion == "" {
			return ReviewResult{Action: ReviewReject}
		}
		return ReviewResult{Action: ReviewSuggest, Suggestion: suggestion}
	}

	return ReviewResult{Action: ReviewReject}
}

func ShowDeleteConfirm(path, operation string) bool {
	warningStyle := lipgloss.NewStyle().
		Foreground(lipgloss.Color("#FF5555")).
		Bold(true).
		Padding(0, 1)

	fmt.Println()
	fmt.Println(warningStyle.Render(fmt.Sprintf("⚠️  %s: %s", operation, path)))

	var approved bool
	form := huh.NewForm(
		huh.NewGroup(
			huh.NewConfirm().
				Title(fmt.Sprintf("Allow %s?", strings.ToLower(operation))).
				Value(&approved).
				Affirmative("Yes, proceed").
				Negative("No, cancel"),
		),
	)

	if err := form.Run(); err != nil {
		return false
	}
	return approved
}

func DetectLanguage(path string) string {
	lower := strings.ToLower(path)
	switch {
	case strings.HasSuffix(lower, ".go"):
		return "Go"
	case strings.HasSuffix(lower, ".rs"):
		return "Rust"
	case strings.HasSuffix(lower, ".py"):
		return "Python"
	case strings.HasSuffix(lower, ".js"):
		return "JavaScript"
	case strings.HasSuffix(lower, ".ts"):
		return "TypeScript"
	case strings.HasSuffix(lower, ".html"):
		return "HTML"
	case strings.HasSuffix(lower, ".css"):
		return "CSS"
	case strings.HasSuffix(lower, ".json"):
		return "JSON"
	case strings.HasSuffix(lower, ".toml"):
		return "TOML"
	case strings.HasSuffix(lower, ".yaml"), strings.HasSuffix(lower, ".yml"):
		return "YAML"
	case strings.HasSuffix(lower, ".md"):
		return "Markdown"
	case strings.HasSuffix(lower, ".sh"), strings.HasSuffix(lower, ".bash"):
		return "Shell"
	case strings.HasSuffix(lower, ".jsx"):
		return "JSX"
	case strings.HasSuffix(lower, ".tsx"):
		return "TSX"
	default:
		return "Text"
	}
}
