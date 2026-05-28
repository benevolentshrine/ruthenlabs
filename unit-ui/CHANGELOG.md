# Changelog

## Unreleased

### Added

- `ThinkingBlock` — collapsible reasoning block with expand/collapse, state indicator, elapsed timer (Pro tier)
- `ToolCallCard` — tool/function call card with arguments, execution status, duration, and result display (Pro tier)
- `DiffView` — unified diff viewer with green additions, red removals, hunk headers, and optional file header (Pro tier)
- `ApprovalPrompt` — permission dialog for tool execution with pending/approved/rejected states (Pro tier)
- `MultiLineInput` — multi-line text area with configurable line number gutter and cursor line highlight (Pro tier)
- `SessionTimeline` — chronological event log with timestamps, icons, and detail lines (Pro tier)
- `MarkdownBlock` — basic markdown renderer supporting headings, bold, inline code, fenced code blocks, and lists (Pro tier)
- 10 new CLI examples showcasing all Free + Pro widgets together:
  - `01_assistant` — AI assistant with tool calling and thinking block
  - `02_review` — Code review with diff viewer and approval prompt
  - `03_panel` — Multi-agent conductor with parallel spinners and timeline
  - `04_setup` — Setup wizard with thinking block and approval flow
  - `05_debug` — Debug console with tool call cards and session timeline
  - `06_render` — Markdown renderer with streaming text and markdown block
  - `07_explore` — Session explorer with timeline, markdown details, and thinking block
  - `08_editor` — Code editor with multi-line input, thinking block, and diff view
  - `09_monitor` — Service monitor with tool call cards and session timeline
  - `10_retro_pro` — Network scanner with thinking block and tool call cards

## 0.1.0 — 2026-05-28

### Added

- Initial release: 8 free-tier widgets for Ratatui
- `StreamingText` — character-by-character token rendering with word-wrap
- `Spinner` — indeterminate progress indicator with multiple frame styles
- `BasicInput` — single-line text input with editing and clipboard support
- `MessageBubble` — chat message display with role-based coloring (user, assistant, system)
- `StatusBar` — lightweight bar showing provider name, model, connection status, and elapsed time
- `ThinkingDots` — animated "..." thinking indicator
- `SlashOption` — slash-command completion menu item
- `StyleToken` — builder-based multi-color theme token for consistent widget styling
- `UnitConfig` — TOML-based theme and configuration parser
- 10 complete CLI examples inspired by real AI agentic tools (Claude Code, Aider, Hermes, OpenCode, etc.)
