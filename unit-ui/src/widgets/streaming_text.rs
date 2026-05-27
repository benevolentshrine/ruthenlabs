use ratatui::buffer::Buffer;
use ratatui::layout::Rect;
use ratatui::style::Style;
use ratatui::text::{Line, Span, Text};
use ratatui::widgets::{Paragraph, Widget, Wrap};

use crate::style::StyleToken;

/// \[Free\] Displays text with a per-character typewriter animation.
///
/// Renders a given string character by character, optionally preceded by a
/// thinking block. Designed for streaming LLM responses in terminal UIs.
///
/// # Example
///
/// ```rust
/// use unit_ui::widgets::StreamingText;
/// let widget = StreamingText::new("Hello, world!");
/// ```
#[derive(Debug, Clone)]
pub struct StreamingText<'a> {
    content: &'a str,
    thinking: Option<&'a str>,
    visible_chars: usize,
    typing_speed: u64,
    scroll_offset: usize,
    style: StyleToken,
}

impl<'a> StreamingText<'a> {
    /// Creates a new `StreamingText` from a string slice.
    ///
    /// All characters are visible by default. Call `.visible_chars(n)` to
    /// limit how many characters are rendered.
    pub fn new(content: &'a str) -> Self {
        Self {
            content,
            thinking: None,
            visible_chars: content.chars().count(),
            typing_speed: 50,
            scroll_offset: 0,
            style: StyleToken::default(),
        }
    }

    /// Number of lines to skip from the top when rendering.
    pub fn scroll_offset(mut self, offset: usize) -> Self {
        self.scroll_offset = offset;
        self
    }

    /// Sets an optional "thinking" block rendered above the content.
    ///
    /// The thinking text is shown in dim style between decorative markers.
    pub fn thinking(mut self, text: &'a str) -> Self {
        self.thinking = Some(text);
        self
    }

    /// Limits rendered characters to `n`.
    ///
    /// Use this to animate a typewriter effect by incrementing `n` over time.
    pub fn visible_chars(mut self, n: usize) -> Self {
        let max = self.content.chars().count();
        self.visible_chars = n.min(max);
        self
    }

    /// Sets the typing speed in characters per second (used by consumers).
    pub fn typing_speed(mut self, cps: u64) -> Self {
        self.typing_speed = cps;
        self
    }

    /// Applies a `StyleToken` to the widget.
    pub fn style(mut self, tokens: StyleToken) -> Self {
        self.style = tokens;
        self
    }
}

impl Widget for &StreamingText<'_> {
    fn render(self, area: Rect, buf: &mut Buffer) {
        if area.width == 0 || area.height == 0 {
            return;
        }

        let mut lines: Vec<Line> = Vec::new();

        if let Some(think) = self.thinking {
            let thinking_style = Style::default().fg(self.style.thinking);
            let dimmed = Style::default().fg(self.style.text_dim);
            let label = Span::styled("  ", thinking_style);
            let text = Span::styled(think, dimmed);
            let close = Span::styled("  ", thinking_style);
            lines.push(Line::from(vec![label]));
            lines.push(Line::from(vec![text]));
            lines.push(Line::from(vec![close]));
            lines.push(Line::from(""));
        }

        let max_chars = self.content.chars().count();
        let visible = if self.visible_chars < max_chars {
            self.content.chars().take(self.visible_chars).collect::<String>()
        } else {
            self.content.to_string()
        };

        let text_style = Style::default().fg(self.style.text);
        let text = Text::styled(visible.to_string(), text_style);
        for line in text.lines {
            lines.push(line);
        }

        let offset = self.scroll_offset.min(lines.len().saturating_sub(1));
        let visible_lines: Vec<_> = lines.into_iter().skip(offset).collect();

        Paragraph::new(Text::from(visible_lines))
            .wrap(Wrap { trim: false })
            .render(area, buf);
    }
}
