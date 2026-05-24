package main

import (
	"fmt"
	"math"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/charmbracelet/bubbles/textinput"
	"github.com/charmbracelet/bubbles/viewport"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
)

type animTickMsg struct{}

const (
	animInterval = 100 * time.Millisecond
	collapseFrames = 8
)

type streamToken struct {
	token     string
	done      bool
	err       error
	reviewReq *reviewInfo
}

type reviewInfo struct {
	Path    string
	Content string
	Lang    string
	ch      chan ReviewAction
}

type streamStartedMsg struct {
	ch chan streamToken
}

var brailleFrames = []string{"⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"}

var (
	styleHeader = lipgloss.NewStyle().
			BorderStyle(lipgloss.RoundedBorder()).
			BorderForeground(ColorDarkGrey).
			Padding(0, 1)

	styleMessage = lipgloss.NewStyle().Padding(0, 1)

	styleUser = lipgloss.NewStyle().
			Foreground(ColorAmber).
			Bold(true)

	styleAssistant = lipgloss.NewStyle().
			Foreground(ColorLightGrey)

	styleSystem = lipgloss.NewStyle().
			Foreground(ColorDarkGrey)

	styleThinking = lipgloss.NewStyle().
			Foreground(ColorDarkGrey).
			Italic(true)

	styleSelected = lipgloss.NewStyle().
			Padding(0, 1).
			Background(lipgloss.Color("#2A2A2A"))

	styleDefaultWrap = lipgloss.NewStyle().Padding(0, 1)

	styleInput = lipgloss.NewStyle().
			BorderStyle(lipgloss.NormalBorder()).
			BorderForeground(ColorDarkGrey).
			Padding(0, 1)
)

type uiModel struct {
	width  int
	height int
	ready  bool

	input    textinput.Model
	viewport viewport.Model

	messages    []Message
	thinking    bool
	currentResp *strings.Builder
	streamCh    chan streamToken

	llm       *LLMClient
	ws        *Workspace
	daemonMgr *DaemonManager
	profile   *ModelProfile
	history   *History
	chatLog   *ChatLogger

	indexerOnline   bool
	sandboxOnline   bool
	modelName       string
	modelSize       string

	showThinking bool

	inputHistory []string
	historyIdx   int

	autoScroll    bool
	pendingReview *reviewInfo

	// Phase 3 — animation state
	thinkingStart   time.Time
	thinkingFrame   int
	collapseContent string
	collapseStep    int
	pulseTick       int
	phase2Started   bool

	// Phase 3.5 — text selection
	selectedMsg int // index of highlighted message (-1 = none)

	// Landing screen state
	mode        string   // "landing" | "chat"
	recentFiles []string // workspace listing for landing sidebar
	fileTree    string   // pre-built tree string for landing sidebar
	landingTip  string   // rotating tip shown in sidebar

	// Granular status
	statusLabel string // e.g. "Planning...", "Executing write..."

	// Command palette
	paletteVisible bool
	paletteFilter  string
	paletteResults []paletteItem
	paletteIdx     int
}

type paletteItem struct {
	id          string
	label       string
	description string
}

var paletteCommands = []paletteItem{
	{"landing", "Switch to Landing Screen", "Return to the launch screen"},
	{"clear", "Clear Chat", "Remove all messages"},
	{"toggle_thinking", "Toggle Thinking Display", "Show/hide AI reasoning blocks"},
	{"toggle_scroll", "Toggle Auto-scroll", "Lock or unlock auto-scrolling"},
	{"exit", "Exit UNIT-01", "Quit the application"},
}

func newUIModel(llm *LLMClient, ws *Workspace, dm *DaemonManager, profile *ModelProfile, history *History, chatLog *ChatLogger) uiModel {
	ti := textinput.New()
	ti.Placeholder = "Type a message or /help..."
	ti.Focus()
	ti.CharLimit = 2000
	ti.Width = 80

	m := uiModel{
		input:          ti,
		inputHistory:   nil,
		historyIdx:     -1,
		messages:       history.All(),
		llm:            llm,
		ws:             ws,
		daemonMgr:      dm,
		profile:        profile,
		history:        history,
		chatLog:        chatLog,
		modelName:      profile.Name,
		modelSize:      profile.ParameterSize,
		indexerOnline:  true,
		sandboxOnline:  true,
		autoScroll:     true,
		mode:           "landing",
		landingTip:     "shift + a for commands",
		currentResp:    &strings.Builder{},
	}

	if ws.Active {
		entries, err := os.ReadDir(ws.Path)
		if err == nil {
			for _, e := range entries {
				name := e.Name()
				if e.IsDir() {
					name += "/"
				}
				m.recentFiles = append(m.recentFiles, name)
			}
		}
		m.fileTree = buildLandingFileTree(ws.Path, 0)
	}

	return m
}

func (m uiModel) Init() tea.Cmd {
	return tea.Batch(
		m.animTick(),
		textinput.Blink,
	)
}

func (m uiModel) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	var cmds []tea.Cmd

	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.height = msg.Height
		if !m.ready {
			m.viewport = viewport.New(msg.Width, m.viewportHeight())
			m.viewport.YPosition = 0
			m.ready = true
		} else {
			m.viewport.Width = msg.Width
			m.viewport.Height = m.viewportHeight()
		}

	case tea.KeyMsg:
		if m.pendingReview != nil {
			switch msg.String() {
			case "y", "enter":
				m.pendingReview.ch <- ReviewApprove
				m.pendingReview = nil
				m.thinking = true
				m.autoScroll = true
				return m, m.readStream()
			case "n", "esc":
				m.pendingReview.ch <- ReviewReject
				m.pendingReview = nil
				m.thinking = true
				m.autoScroll = true
				return m, m.readStream()
			}
		}

		// ── Command Palette ──
		if m.paletteVisible {
			switch msg.String() {
			case "ctrl+p", "esc":
				m.paletteVisible = false
				m.paletteFilter = ""
				return m, nil
			case "enter":
				if len(m.paletteResults) > 0 && m.paletteIdx >= 0 && m.paletteIdx < len(m.paletteResults) {
					item := m.paletteResults[m.paletteIdx]
					m.paletteVisible = false
					m.paletteFilter = ""
					switch item.id {
					case "landing":
						m.mode = "landing"
						return m, nil
					case "clear":
						m.messages = nil
						m.history.messages = nil
						m.inputHistory = nil
						m.historyIdx = -1
						m.collapseContent = ""
						m.collapseStep = 0
						m.input.SetValue("")
						return m, nil
					case "toggle_thinking":
						m.showThinking = !m.showThinking
						return m, nil
					case "toggle_scroll":
						m.autoScroll = !m.autoScroll
						if m.autoScroll {
							m.viewport.GotoBottom()
						}
						return m, nil
					case "exit":
						return m, tea.Quit
					}
				}
			case "up":
				if len(m.paletteResults) > 0 {
					m.paletteIdx--
					if m.paletteIdx < 0 {
						m.paletteIdx = len(m.paletteResults) - 1
					}
				}
			case "down":
				if len(m.paletteResults) > 0 {
					m.paletteIdx++
					if m.paletteIdx >= len(m.paletteResults) {
						m.paletteIdx = 0
					}
				}
			case "backspace":
				if len(m.paletteFilter) > 0 {
					m.paletteFilter = m.paletteFilter[:len(m.paletteFilter)-1]
				}
			default:
				if len(msg.String()) == 1 {
					m.paletteFilter += msg.String()
				}
			}
			m.paletteResults = filterPalette(paletteCommands, m.paletteFilter)
			if m.paletteIdx >= len(m.paletteResults) {
				m.paletteIdx = 0
			}
			return m, nil
		}

		// Ctrl+P opens palette in chat mode
		if msg.String() == "ctrl+p" && m.mode == "chat" {
			m.paletteVisible = true
			m.paletteFilter = ""
			m.paletteResults = filterPalette(paletteCommands, "")
			m.paletteIdx = 0
			return m, nil
		}

		switch msg.String() {
		case "ctrl+c", "esc":
			return m, tea.Quit

		case "enter":
			input := strings.TrimSpace(m.input.Value())
			if m.mode == "landing" {
				m.mode = "chat"
				m.autoScroll = true
				m.viewport.GotoBottom()
				if input == "" {
					break
				}
			} else if input == "" || m.thinking {
				break
			}

			switch input {
			case "/exit", "/quit":
				return m, tea.Quit
			case "/clear":
				m.messages = nil
				m.history.messages = nil
				m.inputHistory = nil
				m.historyIdx = -1
				m.collapseContent = ""
				m.collapseStep = 0
				m.input.SetValue("")
				return m, nil
			}

			userMsg := Message{Role: "user", Content: input, Timestamp: time.Now()}
			m.messages = append(m.messages, userMsg)
			m.history.Append(userMsg)
			m.inputHistory = append(m.inputHistory, input)
			m.historyIdx = -1
			m.input.SetValue("")
			m.thinking = true
			m.thinkingStart = time.Now()
			m.thinkingFrame = 0
			m.collapseContent = ""
			m.collapseStep = 0
			m.phase2Started = false
			m.currentResp.Reset()
			m.autoScroll = true
			m.viewport.GotoBottom()
			m.statusLabel = ""

			return m, m.startStream(input)

		case "tab":
			m.showThinking = !m.showThinking
			return m, nil

		case "up":
			if len(m.inputHistory) == 0 {
				break
			}
			if m.historyIdx == -1 {
				m.historyIdx = len(m.inputHistory) - 1
			} else if m.historyIdx > 0 {
				m.historyIdx--
			}
			m.input.SetValue(m.inputHistory[m.historyIdx])
			m.input.SetCursor(len(m.inputHistory[m.historyIdx]))

		case "down":
			if m.historyIdx == -1 {
				break
			}
			m.historyIdx++
			if m.historyIdx >= len(m.inputHistory) {
				m.historyIdx = -1
				m.input.SetValue("")
			} else {
				m.input.SetValue(m.inputHistory[m.historyIdx])
				m.input.SetCursor(len(m.inputHistory[m.historyIdx]))
			}

		default:
			var cmd tea.Cmd
			m.input, cmd = m.input.Update(msg)
			cmds = append(cmds, cmd)
		}

	case streamStartedMsg:
		m.streamCh = msg.ch
		return m, m.readStream()

	case streamToken:
		if msg.reviewReq != nil {
			m.pendingReview = msg.reviewReq
			m.thinking = false
			break
		}

		// Update granular status label from token content
		if msg.token != "" {
			trimmed := strings.TrimRight(msg.token, "\n")
			if strings.HasPrefix(trimmed, "◆ ") {
				m.statusLabel = strings.TrimPrefix(trimmed, "◆ ")
			} else if strings.HasPrefix(trimmed, "  ") && strings.Contains(trimmed, "→") {
				parts := strings.SplitN(trimmed, "→", 2)
				toolName := strings.TrimSpace(strings.TrimPrefix(parts[0], "  "))
				m.statusLabel = "Executing " + toolName + "..."
			}
		}

		if msg.done {
			m.thinking = false
			m.statusLabel = ""
			fullResp := m.currentResp.String()
			thinkText, cleanResp := splitThinking(fullResp)

			assistantMsg := Message{Role: "assistant", Content: cleanResp, Thinking: thinkText, Timestamp: time.Now()}
			m.messages = append(m.messages, assistantMsg)
			m.history.Append(assistantMsg)

			if m.chatLog != nil && len(m.messages) >= 2 {
				lastUser := m.messages[len(m.messages)-2].Content
				m.chatLog.Append(lastUser, cleanResp)
			}

			m.collapseContent = cleanResp
			m.collapseStep = 0
			m.currentResp.Reset()
			m.streamCh = nil
		} else {
			m.currentResp.WriteString(msg.token)
			if !m.phase2Started && !strings.HasPrefix(msg.token, "◆") && !strings.HasPrefix(msg.token, " [") {
				m.phase2Started = true
			}
		}

		if m.autoScroll {
			m.viewport.GotoBottom()
		}

		if !msg.done && m.streamCh != nil {
			cmds = append(cmds, m.readStream())
		}

	case tea.MouseMsg:
		if msg.Action == tea.MouseActionPress && msg.Button == tea.MouseButtonLeft {
			clickY := msg.Y
			msgIdx := (clickY - 2) / 3 // rough estimate: each msg ~3 lines
			if msgIdx >= 0 && msgIdx < len(m.messages) {
				if m.selectedMsg == msgIdx {
					m.selectedMsg = -1
				} else {
					m.selectedMsg = msgIdx
				}
			}
		}

	case animTickMsg:
		m.pulseTick++
		if m.thinking {
			m.thinkingFrame++
		}
		if m.collapseContent != "" {
			m.collapseStep++
			if m.collapseStep >= collapseFrames {
				m.collapseContent = ""
			}
		}
		cmds = append(cmds, m.animTick())
	}

	if m.ready && m.mode != "landing" {
		prevOffset := m.viewport.YOffset
		var cmd tea.Cmd
		m.viewport, cmd = m.viewport.Update(msg)
		cmds = append(cmds, cmd)
		if m.viewport.YOffset < prevOffset {
			m.autoScroll = false
		}
		if m.viewport.ScrollPercent() >= 1.0 {
			m.autoScroll = true
		}
	}

	return m, tea.Batch(cmds...)
}

func (m uiModel) viewportHeight() int {
	if m.height < 10 {
		return 5
	}
	return m.height - 6
}

func (m uiModel) readStream() tea.Cmd {
	ch := m.streamCh
	return func() tea.Msg {
		tok, ok := <-ch
		if !ok {
			return streamToken{done: true}
		}
		return tok
	}
}

func (m uiModel) animTick() tea.Cmd {
	return tea.Tick(animInterval, func(t time.Time) tea.Msg {
		return animTickMsg{}
	})
}

func (m uiModel) startStream(input string) tea.Cmd {
	ch := make(chan streamToken, 100)

	go func() {
		defer close(ch)

		h := m.history
		ws := m.ws
		llm := m.llm
		profile := m.profile

		ws.Refresh()
		autoCtx := getAutoContext(input, ws)
		estimate := h.TokenEstimate()
		threshold := int(float64(profile.ContextWindow) * profile.CompactionPct)
		if estimate > threshold {
			compactHistory(h, llm)
		}

		maxRetries := profile.MaxRetries

	directivePhase:
		for retry := 0; retry <= maxRetries; retry++ {
			messages := h.BuildOllamaMessages(profile.MaxMessagesPerTurn)
			prompt := getExecutorPrompt(ws, profile) + autoCtx +
				"\n\n### DIRECTIVE PHASE (JSON STRUCTURED OUTPUT):\n" +
				"Map user requests to directives. NEVER use shell commands (ls, cat, grep, find, mv, cp, mkdir).\n" +
				"- To LIST a directory → indexer_ls with {\"path\":\"...\"}\n" +
				"- To READ a file → indexer_read with {\"path\":\"...\"}\n" +
				"- To READ multiple files at once → read_multiple with {\"paths\":[\"...\",\"...\"]}\n" +
				"- To SEARCH file contents → search with {\"query\":\"...\"}\n" +
				"- To GLOB for files by pattern → glob with {\"pattern\":\"**/*.go\",\"base\":\"...\"}\n" +
				"- To FIND files by name → find with {\"name\":\"...\",\"root\":\"...\"}\n" +
				"- To EXECUTE a command → execute with {\"command\":\"...\"}\n" +
				"- To WRITE a file → write with {\"path\":\"...\",\"content\":\"...\"}\n" +
				"- To APPEND to a file → append with {\"path\":\"...\",\"content\":\"...\"}\n" +
				"- To DELETE a file → delete with {\"path\":\"...\"}\n" +
				"- To PATCH a file → patch with {\"path\":\"...\",\"target\":\"...\",\"replacement\":\"...\"}\n" +
				"- To MOVE/RENAME a file → mv with {\"from\":\"...\",\"to\":\"...\"}\n" +
				"- To COPY a file → cp with {\"from\":\"...\",\"to\":\"...\"}\n" +
				"- To CREATE a directory → mkdir with {\"path\":\"...\"}\n" +
				"- To REMOVE a directory → rmdir with {\"path\":\"...\"}\n" +
				"- To GET file info → file_info with {\"path\":\"...\"}\n" +
				"- To DIFF two files → diff with {\"files\":[\"...\",\"...\"]}\n" +
				"- To VIEW project tree → ls_tree with {\"root\":\"...\"}\n" +
				"- To ROLLBACK changes → rollback with {}\n" +
				"Output ONLY a JSON object with a \"directives\" array. " +
				"Do NOT include any explanation, conversation, or markdown. Only output the JSON object."
			messages = append([]ollamaMessage{{Role: "system", Content: prompt}}, messages...)

			ch <- streamToken{token: "◆ Planning..."}
			directives, _, _, err := llm.StreamDirectives(messages, profile.Temperature)
			if err != nil {
				ch <- streamToken{token: fmt.Sprintf(" [Error: %v]\n", err)}
				break directivePhase
			}

			if len(directives) == 0 {
				ch <- streamToken{token: " [no directives needed]\n"}
				break directivePhase
			}

			ch <- streamToken{token: fmt.Sprintf(" [%d directive(s)]\n", len(directives))}

			if retry > 0 {
				ch <- streamToken{token: fmt.Sprintf("◆ Re-trying directives (attempt %d/%d):\n", retry, maxRetries)}
			}

			allOk := true
			for _, dir := range directives {
				if dir.Name == "write" || dir.Name == "delete" || dir.Name == "patch" {
					reviewCh := make(chan ReviewAction, 1)
					ch <- streamToken{
						reviewReq: &reviewInfo{
							Path:    fmt.Sprintf("%v", dir.Args["path"]),
							Content: fmt.Sprintf("%v", dir.Args["content"]),
							Lang:    DetectLanguage(fmt.Sprintf("%v", dir.Args["path"])),
							ch:      reviewCh,
						},
					}
					action := <-reviewCh
					if action != ReviewApprove {
						ch <- streamToken{token: fmt.Sprintf("  %s → [review: skipped by user]\n", dir.Name)}
						continue
					}
				}

				result := ExecuteTool(dir.Name, dir.Args, ws)
				display := result
				if len(display) > profile.MaxToolOutputChars {
					display = fmt.Sprintf("[Tool '%s' output truncated: %d bytes]", dir.Name, len(display))
				}
				ch <- streamToken{token: fmt.Sprintf("  %s → %s\n", dir.Name, truncateOneLine(display, 80))}

				if isToolError(result) {
					allOk = false
					h.Append(Message{
						Role:      "system",
						Content:   fmt.Sprintf("Tool [%s] error (needs correction): %s", dir.Name, result),
						Timestamp: time.Now(),
					})
				} else {
					h.Append(Message{
						Role:      "system",
						Content:   fmt.Sprintf("Tool [%s] completed successfully: %s", dir.Name, result),
						Timestamp: time.Now(),
					})
				}
			}

			if allOk || retry >= maxRetries {
				break directivePhase
			}
			ch <- streamToken{token: fmt.Sprintf("◆ Self-correcting (%d/%d)...\n", retry+1, maxRetries)}
		}

		phase2Messages := h.BuildOllamaMessages(profile.MaxMessagesPerTurn)
		prompt := getExecutorPrompt(ws, profile) + autoCtx +
			"\n\n### RESPONSE PHASE:\n" +
			"The directives have been executed. Results are in the conversation history above. " +
			"Now provide your natural language response to the user. Keep it concise."
		phase2Messages = append([]ollamaMessage{{Role: "system", Content: prompt}}, phase2Messages...)

		wr := &chanWriter{ch: ch}
		finalResponse, _, _, _, err := llm.StreamCLI(phase2Messages, wr, nil, profile.Temperature)
		if err != nil {
			ch <- streamToken{token: fmt.Sprintf("\n[Phase 2 Error: %v]\n", err)}
			finalResponse = "(error generating response)"
		}

		h.Append(Message{Role: "assistant", Content: finalResponse, Timestamp: time.Now()})
	}()

	return func() tea.Msg {
		return streamStartedMsg{ch: ch}
	}
}

type chanWriter struct {
	ch chan<- streamToken
}

func (w *chanWriter) Write(p []byte) (n int, err error) {
	w.ch <- streamToken{token: string(p)}
	return len(p), nil
}

const bigTitle = `
  _   _  _  _  _____  _____  _  _  ___ 
 | | | || || ||_   _||  _  || || ||_ _|
 | | | || || |  | |  | |_| || || | | | 
 | |_| || || |  | |  |  _  || || | | | 
 |  _  || || | _| |_ | | | || || | | | 
 |_| |_| \_/ \_/_____||_| |_||_||_||___|
`

var (
	styleSidebar      = lipgloss.NewStyle().Width(30).BorderStyle(lipgloss.RoundedBorder()).BorderForeground(ColorDarkGrey)
	styleSidebarTitle = lipgloss.NewStyle().Bold(true).Foreground(ColorAmber)
	styleCmdBox       = lipgloss.NewStyle().BorderStyle(lipgloss.NormalBorder()).BorderForeground(ColorDarkGrey).Padding(0, 2)
	styleBuildLine     = lipgloss.NewStyle().Foreground(ColorDarkGrey).Padding(0, 2)
	styleQuickCmds     = lipgloss.NewStyle().Foreground(ColorDarkGrey).Padding(0, 2)
	styleTip           = lipgloss.NewStyle().Foreground(ColorDarkGrey).Padding(0, 2)
	styleVersion       = lipgloss.NewStyle().Foreground(ColorDarkGrey)
	styleStatusKey    = lipgloss.NewStyle().Foreground(lipgloss.Color("#4A9EFF"))
	styleStatusPath   = lipgloss.NewStyle().Foreground(ColorDarkGrey)
	styleStatusRight  = lipgloss.NewStyle().Foreground(ColorLightGrey)
	styleLandingTitle = lipgloss.NewStyle().Bold(true).Foreground(ColorAmber)
	styleLandingSub   = lipgloss.NewStyle().Foreground(ColorDarkGrey)

	stylePaletteTitle   = lipgloss.NewStyle().Bold(true).Foreground(ColorAmber)
	stylePaletteItem    = lipgloss.NewStyle().Foreground(ColorLightGrey)
	stylePaletteSelected = lipgloss.NewStyle().Foreground(ColorBlack).Background(ColorAmber)
)

func filterPalette(items []paletteItem, query string) []paletteItem {
	if query == "" {
		return items
	}
	q := strings.ToLower(query)
	var out []paletteItem
	for _, it := range items {
		if strings.Contains(strings.ToLower(it.label), q) || strings.Contains(strings.ToLower(it.description), q) {
			out = append(out, it)
		}
	}
	return out
}

func buildLandingFileTree(root string, depth int) string {
	if depth > 2 {
		return ""
	}
	entries, err := os.ReadDir(root)
	if err != nil {
		return ""
	}
	var b strings.Builder
	for _, e := range entries {
		indent := strings.Repeat("  ", depth)
		if e.IsDir() {
			b.WriteString(fmt.Sprintf("%s%s/\n", indent, e.Name()))
			b.WriteString(buildLandingFileTree(filepath.Join(root, e.Name()), depth+1))
		} else {
			b.WriteString(fmt.Sprintf("%s%s\n", indent, e.Name()))
		}
	}
	return b.String()
}

func (m uiModel) landingView() string {
	sideW := 30
	if m.width < 80 {
		sideW = 0
	}
	mainW := m.width - sideW - 2
	if mainW < 40 && sideW > 0 {
		sideW = m.width / 3
		mainW = m.width - sideW - 2
	}
	availH := m.height - 2
	contentW := sideW - 4 // sidebar width minus border(2) minus padding(2)

	// ── Sidebar ──
	var recentItems []string
	for i, f := range m.recentFiles {
		if i >= 8 {
			recentItems = append(recentItems, ThemeDimStyle.Render(fmt.Sprintf("  ... (%d more)", len(m.recentFiles)-8)))
			break
		}
		recentItems = append(recentItems, ThemeTextStyle.Render("  "+f))
	}
	recentSection := lipgloss.JoinVertical(lipgloss.Top, recentItems...)

	fileTreeSection := ThemeTextStyle.Render(m.fileTree)
	if m.fileTree == "" {
		fileTreeSection = ThemeDimStyle.Render("  No workspace loaded")
	}

	sidebarContent := lipgloss.JoinVertical(lipgloss.Top,
		styleSidebarTitle.Copy().Width(contentW).Render("Recent Files"),
		recentSection,
		"",
		styleSidebarTitle.Copy().Width(contentW).Render("File Tree"),
		fileTreeSection,
	)
	sidebar := lipgloss.NewStyle().
		Width(sideW).
		Height(availH).
		BorderStyle(lipgloss.RoundedBorder()).
		BorderForeground(ColorDarkGrey).
		Padding(0, 1).
		Render(sidebarContent)

	// ── Main content ──
	boxW := mainW
	maxBoxW := mainW - 10
	if maxBoxW > 90 {
		maxBoxW = 90
	}
	if boxW > maxBoxW {
		boxW = maxBoxW
	}
	innerW := boxW - 4

	titleBlock := lipgloss.JoinVertical(lipgloss.Center,
		"",
		"",
		lipgloss.NewStyle().Foreground(ColorAmber).Width(mainW).Align(lipgloss.Center).Render(bigTitle),
		"",
	)

	// Build the prompt box content
	buildStatus := fmt.Sprintf("Build : %s Ollama  high", m.modelName)
	quickCmds := "tab agents ctrl+p commands"
	
	statusLine := lipgloss.JoinHorizontal(lipgloss.Top,
		styleBuildLine.Width(innerW*60/100).Render(buildStatus),
		styleQuickCmds.Width(innerW*40/100).Align(lipgloss.Right).Render(quickCmds),
	)

	// Split prompt bar from the status bar to create a distinct line/separation
	promptView := styleLandingTitle.Copy().Width(innerW).Align(lipgloss.Center).Render(m.input.View())
	
	cmdInner := lipgloss.JoinVertical(lipgloss.Left,
		"",
		promptView,
		"",
		statusLine,
		"",
	)
	
	// Render prompt box with distinct styling
	cmdBox := styleCmdBox.Render(cmdInner)
	cmdBoxCenter := lipgloss.NewStyle().Width(mainW).Align(lipgloss.Center).Render(cmdBox)

	//- Tip and Version
	tipLine := styleTip.Width(mainW).Align(lipgloss.Center).Render("● Tip " + m.landingTip)
	versionLine := styleVersion.Width(mainW).Align(lipgloss.Right).Render("1.5.0")

	vertCenterH := availH - 4
	if vertCenterH < 1 {
		vertCenterH = 1
	}
	centered := lipgloss.PlaceVertical(vertCenterH, lipgloss.Center,
		lipgloss.JoinVertical(lipgloss.Top,
			titleBlock,
			cmdBoxCenter,
			"",
			tipLine,
		),
	)
	
	mainArea := lipgloss.NewStyle().Width(mainW).Padding(0, 1).Render(
		lipgloss.JoinVertical(lipgloss.Top, 
			centered, 
			"", 
			versionLine,
		),
	)

	return lipgloss.JoinHorizontal(lipgloss.Top, sidebar, mainArea)
}

func (m uiModel) renderPalette() string {
	palW := 50
	if m.width < 60 {
		palW = m.width - 4
	}
	maxH := m.viewportHeight() - 4
	if maxH < 6 {
		maxH = 6
	}
	palH := len(m.paletteResults) + 4
	if palH > maxH {
		palH = maxH
	}
	if palH < 4 {
		palH = 4
	}

	var rows []string
	for i, item := range m.paletteResults {
		line := fmt.Sprintf("  %s", item.label)
		if i == m.paletteIdx {
			rows = append(rows, stylePaletteSelected.Render(line))
		} else {
			rows = append(rows, stylePaletteItem.Render(line))
		}
	}
	if len(m.paletteResults) == 0 {
		rows = append(rows, stylePaletteItem.Render("  No matching commands"))
	}

	palContent := lipgloss.JoinVertical(lipgloss.Left, rows...)

	palBox := lipgloss.NewStyle().
		Width(palW).
		BorderStyle(lipgloss.RoundedBorder()).
		BorderForeground(ColorAmber).
		Padding(0, 1).
		Render(palContent)

	filterLine := m.paletteFilter
	if filterLine == "" {
		filterLine = " "
	}
	filterBar := styleStatusKey.Render(fmt.Sprintf("❯ %s", filterLine))

	return lipgloss.Place(m.width-2, m.viewportHeight(),
		lipgloss.Center, lipgloss.Center,
		lipgloss.JoinVertical(lipgloss.Top,
			stylePaletteTitle.Render("  Command Palette  "),
			filterBar,
			palBox,
		),
	)
}

func (m uiModel) View() string {
	if !m.ready {
		return "Initializing..."
	}

	if m.mode == "landing" {
		return m.landingView()
	}

	var content strings.Builder

	if m.pendingReview != nil {
		preview := m.pendingReview.Content
		lineCount := strings.Count(preview, "\n") + 1
		if lineCount > 60 {
			lines := strings.SplitN(preview, "\n", 61)
			preview = strings.Join(lines[:60], "\n") + fmt.Sprintf("\n... (%d more lines)", lineCount-60)
		}
		content.WriteString(styleMessage.Render(
			lipgloss.NewStyle().Bold(true).Foreground(ColorAmber).Render(
				fmt.Sprintf("📄 %s (%s, %d lines)", m.pendingReview.Path, m.pendingReview.Lang, lineCount)) + "\n",
		))
		for _, line := range strings.Split(preview, "\n") {
			content.WriteString("  " + line + "\n")
		}
		content.WriteString("\n")
		content.WriteString(styleMessage.Render(styleThinking.Render("Approve? (y)es / (n)o") + "\n"))
	} else {
		for i, msg := range m.messages {
			wrap := styleDefaultWrap
			if i == m.selectedMsg {
				wrap = styleSelected
			}
			switch msg.Role {
			case "user":
				lines := strings.Split(msg.Content, "\n")
				for j, line := range lines {
					p := "      "
					if j == 0 {
						p = "USR » "
					}
					content.WriteString(wrap.Render(styleUser.Render(p+line)))
					content.WriteString("\n")
				}
			case "assistant":
				if msg.Thinking != "" {
					if m.showThinking {
						content.WriteString(wrap.Render(styleThinking.Render("▼ [Hide reasoning]")))
						content.WriteString("\n")
						for _, line := range strings.Split(msg.Thinking, "\n") {
							content.WriteString(wrap.Render(styleThinking.Render("  "+line)))
							content.WriteString("\n")
						}
					} else {
						content.WriteString(wrap.Render(styleThinking.Render("▶ [Show reasoning]")))
						content.WriteString("\n")
					}
				}
				rendered := renderMarkdown(msg.Content)
				lines := strings.Split(rendered, "\n")
				for j, line := range lines {
					p := "      "
					if j == 0 {
						p = "SYS ● "
					}
					content.WriteString(wrap.Render(styleAssistant.Render(p+line)))
					content.WriteString("\n")
				}
			case "system":
				content.WriteString(wrap.Render(styleSystem.Render(msg.Content)))
				content.WriteString("\n")
			}
		}

		if m.collapseContent != "" {
			lines := strings.Split(m.collapseContent, "\n")
			keep := int(math.Ceil(float64(len(lines)) * float64(collapseFrames-m.collapseStep) / float64(collapseFrames)))
			if keep < 1 {
				keep = 1
			}
			for i := 0; i < keep && i < len(lines); i++ {
				alpha := 1.0 - float64(m.collapseStep)/float64(collapseFrames)
				grey := int(80 * alpha)
				fadeStyle := lipgloss.NewStyle().Foreground(lipgloss.Color(fmt.Sprintf("#%02x%02x%02x", grey, grey, grey)))
				content.WriteString(styleMessage.Render(fadeStyle.Render(lines[i]) + "\n"))
			}
		}

		if m.thinking {
			resp := m.currentResp.String()
			cleanResp := strings.ReplaceAll(resp, "<thinking>", "")
			cleanResp = strings.ReplaceAll(cleanResp, "</thinking>", "")

			if !m.phase2Started && cleanResp == "" {
				skeletonGrey := lipgloss.Color("#404040")
				skeletonStyle := lipgloss.NewStyle().Foreground(skeletonGrey)
				for i := 0; i < 3; i++ {
					content.WriteString(styleMessage.Render(skeletonStyle.Render("▌          ") + "\n"))
				}
			} else if strings.Contains(resp, "<thinking>") {
				lines := strings.Split("● Thinking... "+cleanResp, "\n")
				for _, line := range lines {
					content.WriteString(styleMessage.Render(styleThinking.Render(line) + "\n"))
				}
			} else if cleanResp != "" {
				lines := strings.Split(cleanResp, "\n")
				for j, line := range lines {
					p := "      "
					if j == 0 {
						p = "SYS ● "
					}
					content.WriteString(styleMessage.Render(styleAssistant.Render(p+line)))
					content.WriteString("\n")
				}
			}

			frame := brailleFrames[m.thinkingFrame%len(brailleFrames)]
			elapsed := time.Since(m.thinkingStart).Truncate(time.Second)
			label := m.statusLabel
			if label == "" {
				label = "Processing..."
			}
			content.WriteString(styleMessage.Render(styleThinking.Render(
				fmt.Sprintf("%s %s (%s)\n", frame, label, elapsed),
			)))
		}
	}

	m.viewport.SetContent(content.String())

	scrollIndicator := ""
	if !m.autoScroll && !m.thinking {
		scrollIndicator = " │  🔒 SCROLLED"
	}

	header := styleHeader.Render(
		fmt.Sprintf("UNIT-01 v1.5.0  │  %s (%s)  │  INDEX:%s  SANDBOX:%s%s",
			m.modelName, m.modelSize, m.statusDot(m.indexerOnline), m.statusDot(m.sandboxOnline), scrollIndicator,
		),
	)

	inputBar := styleInput.Render(
		fmt.Sprintf("» %s", m.input.View()),
	)

	body := m.viewport.View()

	if m.paletteVisible {
		body = m.renderPalette()
	}

	return fmt.Sprintf("%s\n%s\n%s", header, body, inputBar)
}

func (m uiModel) statusDot(ok bool) string {
	if !ok {
		return lipgloss.NewStyle().Foreground(ColorWarning).Render("●")
	}
	phase := float64(m.pulseTick%60) / 60.0
	brightness := 0.5 + 0.5*math.Sin(phase*2*math.Pi)
	r := int(0xFF * brightness)
	g := int(0xB0 * brightness)
	if g > 0xB0 {
		g = 0xB0
	}
	color := fmt.Sprintf("#%02x%02x00", r, g)
	return lipgloss.NewStyle().Foreground(lipgloss.Color(color)).Render("●")
}

func splitThinking(content string) (thinking, clean string) {
	var t, c strings.Builder
	inThink := false
	i := 0
	for i < len(content) {
		if strings.HasPrefix(content[i:], "<thinking>") {
			inThink = true
			i += 10
		} else if strings.HasPrefix(content[i:], "</thinking>") {
			inThink = false
			i += 12
		} else {
			if inThink {
				t.WriteByte(content[i])
			} else {
				c.WriteByte(content[i])
			}
			i++
		}
	}
	return strings.TrimSpace(t.String()), strings.TrimSpace(c.String())
}
