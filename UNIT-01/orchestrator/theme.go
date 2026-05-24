package main

import "github.com/charmbracelet/lipgloss"

var (
	BrandColor     = lipgloss.Color("#00E5FF")
	ColorAmber     = lipgloss.Color("#FFB000")
	ColorLightGrey = lipgloss.Color("#A0A0A0")
	ColorDarkGrey  = lipgloss.Color("#444444")
	ColorBlack     = lipgloss.Color("#000000")

	ColorWarning   = lipgloss.Color("#FF5555")
	ColorSuccess   = lipgloss.Color("#FFB000")

	ThemeBrandStyle  = lipgloss.NewStyle().Foreground(ColorAmber).Bold(true)
	ThemeDimStyle    = lipgloss.NewStyle().Foreground(ColorDarkGrey)
	ThemeTextStyle   = lipgloss.NewStyle().Foreground(ColorLightGrey)
	ThemeBorderStyle = lipgloss.NewStyle().BorderStyle(lipgloss.RoundedBorder()).BorderForeground(ColorAmber)

	ThemePromptStyle = lipgloss.NewStyle().Foreground(ColorAmber).Bold(true)
	ThemeToolStyle   = lipgloss.NewStyle().Foreground(ColorDarkGrey).Italic(true)
)
