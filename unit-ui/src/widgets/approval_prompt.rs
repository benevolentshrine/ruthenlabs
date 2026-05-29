use ratatui::buffer::Buffer;
use ratatui::layout::Rect;
use ratatui::style::Style;
use ratatui::text::{Line, Span, Text};
use ratatui::widgets::{Block, Borders, Paragraph, Widget, Wrap};

use crate::style::StyleToken;

/// \[Pro\] The user's decision on a tool execution prompt.
///
/// # Doc aliases
///
/// `permission state`, `decision`
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ApprovalStatus {
    /// Awaiting user decision.
    Pending,
    /// User approved the tool call.
    Approved,
    /// User rejected the tool call.
    Rejected,
}

/// \[Pro\] A permission dialog that prompts the user to approve or reject
/// a tool execution, following the safety-interrupt pattern used by
/// Claude Code and Goose.
///
/// # Doc aliases
///
/// `permission dialog`, `tool approval`, `confirm dialog`, `safety prompt`
///
/// Renders a prominently bordered card showing the tool name, arguments,
/// and the reason for execution, with a clear status indicating whether
/// approval is still pending, was granted, or was denied.
///
/// # Example
///
/// ```rust
/// use unit_ui::widgets::{ApprovalPrompt, ApprovalStatus};
///
/// let prompt = ApprovalPrompt::new()
///     .tool_name("bash")
///     .args("rm -rf /tmp/cache")
///     .reason("Clean temporary build artifacts")
///     .status(ApprovalStatus::Pending);
/// ```
#[derive(Debug, Clone)]
pub struct ApprovalPrompt<'a> {
    tool_name: &'a str,
    args: &'a str,
    reason: &'a str,
    status: ApprovalStatus,
    style: StyleToken,
}

impl<'a> ApprovalPrompt<'a> {
    /// Creates a new `ApprovalPrompt` with `Pending` status.
    pub fn new() -> Self {
        Self {
            tool_name: "",
            args: "",
            reason: "",
            status: ApprovalStatus::Pending,
            style: StyleToken::default(),
        }
    }

    /// Sets the tool name requesting permission.
    pub fn tool_name(mut self, name: &'a str) -> Self {
        self.tool_name = name;
        self
    }
    /// Sets the tool arguments displayed.
    pub fn args(mut self, args: &'a str) -> Self {
        self.args = args;
        self
    }
    /// Sets the human-readable reason explaining why this tool is needed.
    pub fn reason(mut self, reason: &'a str) -> Self {
        self.reason = reason;
        self
    }
    /// Sets the current approval status.
    pub fn status(mut self, status: ApprovalStatus) -> Self {
        self.status = status;
        self
    }
    /// Applies a `StyleToken`.
    pub fn style(mut self, tokens: StyleToken) -> Self {
        self.style = tokens;
        self
    }
}

impl Default for ApprovalPrompt<'_> {
    fn default() -> Self {
        Self::new()
    }
}

impl Widget for ApprovalPrompt<'_> {
    fn render(self, area: Rect, buf: &mut Buffer) {
        (&self).render(area, buf);
    }
}

impl Widget for &ApprovalPrompt<'_> {
    fn render(self, area: Rect, buf: &mut Buffer) {
        if area.width < 6 || area.height < 5 {
            return;
        }

        let (border_color, badge, badge_style) = match self.status {
            ApprovalStatus::Pending => (
                self.style.thinking,
                "● AWAITING APPROVAL",
                Style::default()
                    .fg(self.style.thinking)
                    .add_modifier(ratatui::style::Modifier::BOLD),
            ),
            ApprovalStatus::Approved => (
                self.style.success,
                "✓ APPROVED",
                Style::default()
                    .fg(self.style.success)
                    .add_modifier(ratatui::style::Modifier::BOLD),
            ),
            ApprovalStatus::Rejected => (
                self.style.error,
                "✗ REJECTED",
                Style::default()
                    .fg(self.style.error)
                    .add_modifier(ratatui::style::Modifier::BOLD),
            ),
        };

        let block = Block::default()
            .borders(Borders::ALL)
            .border_style(Style::default().fg(border_color));
        let inner = block.inner(area);
        block.render(area, buf);

        let dimmed = Style::default().fg(self.style.text_dim);
        let text = Style::default().fg(self.style.text);

        // Header: tool name + badge
        let mut y = inner.y;
        let header = Line::from(vec![
            Span::styled("🔒 ", Style::default().fg(self.style.accent)),
            Span::styled(
                self.tool_name,
                Style::default()
                    .fg(self.style.accent)
                    .add_modifier(ratatui::style::Modifier::BOLD),
            ),
            Span::styled("  ", dimmed),
            Span::styled(badge, badge_style),
        ]);
        header.render(
            Rect {
                x: inner.x,
                y,
                width: inner.width,
                height: 1,
            },
            buf,
        );
        y += 1;

        // Reason
        if !self.reason.is_empty() && y < inner.bottom() {
            let reason_lines: Vec<&str> = self.reason.lines().collect();
            let h = (reason_lines.len() as u16 + 1).min(inner.bottom().saturating_sub(y));
            let reason_text = Text::styled(self.reason, dimmed);
            let reason_para = Paragraph::new(reason_text).wrap(Wrap { trim: false });
            reason_para.render(
                Rect {
                    x: inner.x,
                    y,
                    width: inner.width,
                    height: h,
                },
                buf,
            );
            y += h;
        }

        // Arguments box
        if !self.args.is_empty() && y + 1 < inner.bottom() {
            let args_block = Block::default()
                .borders(Borders::TOP)
                .border_style(Style::default().fg(self.style.text_dim));
            let args_inner = args_block.inner(Rect {
                x: inner.x,
                y,
                width: inner.width,
                height: inner.bottom().saturating_sub(y),
            });

            let arg_label = Line::from(Span::styled(" Arguments:", dimmed));
            arg_label.render(
                Rect {
                    x: args_inner.x,
                    y: args_inner.y - 1,
                    width: 12,
                    height: 1,
                },
                buf,
            );

            let arg_text = Text::styled(self.args, text);
            let arg_para = Paragraph::new(arg_text).wrap(Wrap { trim: false });
            let h = inner.bottom().saturating_sub(y + 1);
            arg_para.render(
                Rect {
                    x: args_inner.x,
                    y: args_inner.y,
                    width: args_inner.width,
                    height: h,
                },
                buf,
            );
        }
    }
}
