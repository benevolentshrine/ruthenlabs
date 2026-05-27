use std::time::Duration;

use ratatui::buffer::Buffer;
use ratatui::layout::Rect;
use ratatui::style::Style;
use ratatui::text::{Line, Span, Text};
use ratatui::widgets::{Block, Borders, Widget};
use ratatui::widgets::{Paragraph, Wrap};

use crate::style::StyleToken;

/// \[Pro\] The execution status of a tool call.
///
/// # Doc aliases
///
/// `tool status`, `call state`
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ToolStatus {
    /// Tool call is queued.
    Pending,
    /// Tool is currently executing.
    Running,
    /// Tool completed successfully.
    Success,
    /// Tool returned an error.
    Error,
}

/// \[Pro\] A styled card displaying a tool/function call with arguments,
/// execution status, duration, and result.
///
/// # Doc aliases
///
/// `function call`, `tool card`, `tool result`, `tool execution`
///
/// Renders a bordered card containing the tool name, formatted arguments,
/// a status badge, elapsed time, and the return value. Follows the same
/// visual pattern used by Claude Code and Codex CLI.
///
/// # Example
///
/// ```rust
/// use std::time::Duration;
/// use unit_ui::widgets::{ToolCallCard, ToolStatus};
///
/// let card = ToolCallCard::new()
///     .tool_name("read_file")
///     .arguments(r#"{"path": "src/main.rs"}"#)
///     .status(ToolStatus::Success)
///     .duration(Duration::from_millis(42));
/// ```
#[derive(Debug, Clone)]
pub struct ToolCallCard<'a> {
    tool_name: &'a str,
    arguments: &'a str,
    status: ToolStatus,
    result: &'a str,
    duration: Option<Duration>,
    style: StyleToken,
}

impl<'a> ToolCallCard<'a> {
    /// Creates a new `ToolCallCard` with default `Pending` status.
    pub fn new() -> Self {
        Self {
            tool_name: "",
            arguments: "",
            status: ToolStatus::Pending,
            result: "",
            duration: None,
            style: StyleToken::default(),
        }
    }

    /// Sets the tool or function name (e.g. "read_file", "bash").
    pub fn tool_name(mut self, name: &'a str) -> Self { self.tool_name = name; self }
    /// Sets the arguments as a formatted string (typically JSON).
    pub fn arguments(mut self, args: &'a str) -> Self { self.arguments = args; self }
    /// Sets the execution status.
    pub fn status(mut self, status: ToolStatus) -> Self { self.status = status; self }
    /// Sets the result/output returned by the tool.
    pub fn result(mut self, result: &'a str) -> Self { self.result = result; self }
    /// Sets the elapsed execution duration.
    pub fn duration(mut self, dur: Duration) -> Self { self.duration = Some(dur); self }
    /// Applies a `StyleToken` to the widget.
    pub fn style(mut self, tokens: StyleToken) -> Self { self.style = tokens; self }
}

impl Default for ToolCallCard<'_> {
    fn default() -> Self { Self::new() }
}

impl Widget for &ToolCallCard<'_> {
    fn render(self, area: Rect, buf: &mut Buffer) {
        if area.width < 4 || area.height < 3 { return; }

        let block = Block::default()
            .borders(Borders::ALL)
            .border_style(Style::default().fg(self.style.text_dim));
        let inner = block.inner(area);
        block.render(area, buf);

        let dimmed = Style::default().fg(self.style.text_dim);
        let accent = Style::default().fg(self.style.accent);
        let success = Style::default().fg(self.style.success);
        let error = Style::default().fg(self.style.error);
        let thinking = Style::default().fg(self.style.thinking);

        // Header: tool name + status badge + duration
        let status_badge = match self.status {
            ToolStatus::Pending => ("◌ pending", dimmed),
            ToolStatus::Running => ("● running", thinking),
            ToolStatus::Success => ("✓ success", success),
            ToolStatus::Error => ("✗ error", error),
        };

        let mut header_parts = vec![
            Span::styled("⚡ ", accent),
            Span::styled(self.tool_name, accent),
            Span::styled("  ", dimmed),
            Span::styled(status_badge.0, status_badge.1),
        ];

        if let Some(dur) = self.duration {
            let ms = dur.as_millis();
            header_parts.push(Span::styled(
                if ms >= 1000 { format!("  ({:.1}s)", ms as f64 / 1000.0) }
                else { format!("  ({}ms)", ms) },
                dimmed,
            ));
        }

        let header = Line::from(header_parts);
        let mut y = inner.y;
        header.render(Rect { x: inner.x, y, width: inner.width, height: 1 }, buf);
        y += 1;

        // Arguments
        if !self.arguments.is_empty() && y < inner.bottom() {
            let arg_lines: Vec<&str> = self.arguments.lines().collect();
            let arg_h = (arg_lines.len() as u16).min(inner.bottom().saturating_sub(y));
            let arg_text = Text::styled(self.arguments, dimmed);
            let arg_para = Paragraph::new(arg_text).wrap(Wrap { trim: false });
            arg_para.render(Rect { x: inner.x, y, width: inner.width, height: arg_h }, buf);
            y += arg_h;
        }

        // Result
        if !self.result.is_empty() && y < inner.bottom() {
            if y > inner.y + 1 {
                let sep = Line::from(Span::styled("─".repeat(inner.width as usize), dimmed));
                sep.render(Rect { x: inner.x, y, width: inner.width, height: 1 }, buf);
                y += 1;
            }
            let result_style = Style::default().fg(self.style.text);
            let result_text = Text::styled(self.result, result_style);
            let h = inner.bottom().saturating_sub(y);
            let result_para = Paragraph::new(result_text).wrap(Wrap { trim: false });
            result_para.render(Rect { x: inner.x, y, width: inner.width, height: h }, buf);
        }
    }
}
