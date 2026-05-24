package main

import (
	"strings"

	"github.com/charmbracelet/glamour"
)

// skipANSI returns the byte offset past any leading ANSI escape sequences.
func skipANSI(s string) int {
	for i := 0; i < len(s); i++ {
		if s[i] == '\033' {
			if j := strings.IndexByte(s[i:], 'm'); j >= 0 {
				i += j
				continue
			}
		}
		return i
	}
	return len(s)
}

func renderMarkdown(content string) string {
	if content == "" {
		return content
	}
	out, err := glamour.Render(content, "dark")
	if err != nil {
		return content
	}
	out = strings.TrimRight(out, "\n")
	// Glamour's dark style adds a 2-space left margin after the ANSI
	// prefix on each line.  Strip it so our own prefix controls alignment.
	lines := strings.Split(out, "\n")
	for i, line := range lines {
		off := skipANSI(line)
		if off+2 <= len(line) && line[off:off+2] == "  " {
			line = line[:off] + line[off+2:]
		}
		lines[i] = line
	}
	return strings.Join(lines, "\n")
}
