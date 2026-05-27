use std::time::Duration;

use ratatui::buffer::Buffer;
use ratatui::layout::Rect;
use ratatui::style::Style;
use ratatui::text::{Line, Span, Text};
use ratatui::widgets::{Block, Borders, Paragraph, Widget, Wrap};

use crate::style::StyleToken;

/// \[Pro\] The lifecycle state of a thinking/reasoning block.
///
/// # Doc aliases
///
/// `reasoning state`, `thinking lifecycle`
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ThinkingState {
    /// Model is actively reasoning — shows animated dots.
    Thinking,
    /// Reasoning completed successfully — shows a checkmark.
    Completed,
    /// Reasoning encountered an error — shows an error indicator.
    Error,
}

/// \[Pro\] A collapsible reasoning block that displays the model's
/// chain-of-thought, following the same pattern used by Claude Code
/// and other agent CLIs.
///
/// # Doc aliases
///
/// `reasoning block`, `chain of thought`, `expandable`, `thinking`
///
/// Shows a header line with expand/collapse icon, label, state indicator,
/// and elapsed time. When expanded, the content is rendered below inside a
/// bordered block with word-wrap. The caller controls the expanded state
/// and animation frame index.
///
/// # Example
///
/// ```rust
/// use std::time::Duration;
/// use unit_ui::widgets::{ThinkingBlock, ThinkingState};
///
/// let block = ThinkingBlock::new()
///     .label("Reasoning")
///     .state(ThinkingState::Completed)
///     .content("The user is asking about authentication.")
///     .expanded(true)
///     .elapsed(Duration::from_secs(3));
/// ```
#[derive(Debug, Clone)]
pub struct ThinkingBlock<'a> {
    label: String,
    state: ThinkingState,
    content: &'a str,
    expanded: bool,
    frame_index: usize,
    elapsed: Option<Duration>,
    style: StyleToken,
}

impl<'a> ThinkingBlock<'a> {
    /// Creates a new `ThinkingBlock` in the `Thinking` state.
    pub fn new() -> Self {
        Self {
            label: String::from("Thinking"),
            state: ThinkingState::Thinking,
            content: "",
            expanded: false,
            frame_index: 0,
            elapsed: None,
            style: StyleToken::default(),
        }
    }

    /// Sets the header label (e.g. "Reasoning", "Chain of thought").
    pub fn label(mut self, label: impl Into<String>) -> Self {
        self.label = label.into();
        self
    }

    /// Sets the current thinking state.
    pub fn state(mut self, state: ThinkingState) -> Self {
        self.state = state;
        self
    }

    /// Sets the reasoning content displayed when expanded.
    pub fn content(mut self, content: &'a str) -> Self {
        self.content = content;
        self
    }

    /// Sets whether the block is expanded to show reasoning content.
    pub fn expanded(mut self, expanded: bool) -> Self {
        self.expanded = expanded;
        self
    }

    /// Sets the animation frame index for the thinking dots.
    pub fn frame_index(mut self, index: usize) -> Self {
        self.frame_index = index;
        self
    }

    /// Sets the elapsed duration displayed on the header.
    pub fn elapsed(mut self, duration: Duration) -> Self {
        self.elapsed = Some(duration);
        self
    }

    /// Applies a `StyleToken` to the widget.
    pub fn style(mut self, tokens: StyleToken) -> Self {
        self.style = tokens;
        self
    }
}

impl Default for ThinkingBlock<'_> {
    fn default() -> Self {
        Self::new()
    }
}

fn format_duration(d: Duration) -> String {
    let secs = d.as_secs();
    if secs >= 60 {
        format!("{:02}:{:02}", secs / 60, secs % 60)
    } else {
        format!("{}.{:01}s", secs, (d.subsec_millis() / 100) % 10)
    }
}

impl Widget for &ThinkingBlock<'_> {
    fn render(self, area: Rect, buf: &mut Buffer) {
        if area.width == 0 || area.height == 0 {
            return;
        }

        let dimmed = Style::default().fg(self.style.text_dim);
        let thinking_color = Style::default().fg(self.style.thinking);
        let success_color = Style::default().fg(self.style.success);
        let error_color = Style::default().fg(self.style.error);

        // State indicator
        let (state_icon, state_style): (&str, Style) = match self.state {
            ThinkingState::Thinking => {
                let frames = [".  ", ".. ", "...", " ..", "  .", "   "];
                let dots = frames[self.frame_index % frames.len()];
                (dots, thinking_color)
            }
            ThinkingState::Completed => ("✓", success_color),
            ThinkingState::Error => ("✗", error_color),
        };

        // Expand/collapse icon
        let expand_icon = if self.expanded { "▼" } else { "▶" };

        // Build header
        let mut header_parts: Vec<Span> = vec![
            Span::styled(format!("{} ", expand_icon), dimmed),
            Span::styled(self.label.as_str(), thinking_color),
            Span::styled(" ", dimmed),
            Span::styled(state_icon, state_style),
        ];

        if let Some(dur) = self.elapsed {
            header_parts.push(Span::styled(
                format!(" ({})", format_duration(dur)),
                dimmed,
            ));
        }

        let header_line = Line::from(header_parts);
        header_line.render(Rect { x: area.x, y: area.y, width: area.width, height: 1 }, buf);

        // Render content when expanded
        if self.expanded && !self.content.is_empty() && area.height > 2 {
            let content_area = Rect {
                x: area.x,
                y: area.y + 1,
                width: area.width,
                height: area.height - 1,
            };

            let block = Block::default()
                .borders(Borders::ALL)
                .border_style(Style::default().fg(self.style.text_dim));
            let inner = block.inner(content_area);
            buf.set_style(content_area, Style::default());
            block.render(content_area, buf);

            if inner.width > 0 && inner.height > 0 {
                let content_style = Style::default().fg(self.style.text);
                let text = Text::styled(self.content, content_style);
                let para = Paragraph::new(text).wrap(Wrap { trim: false });
                para.render(inner, buf);
            }
        }
    }
}
