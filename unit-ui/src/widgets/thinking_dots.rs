use ratatui::buffer::Buffer;
use ratatui::layout::Rect;
use ratatui::style::Style;
use ratatui::text::Span;
use ratatui::widgets::Widget;

use crate::style::StyleToken;

/// \[Free\] An animated "thinking" dots indicator (`. .. ... .. .`).
///
/// # Doc aliases
///
/// `ellipsis`, `waiting`, `processing indicator`
///
/// Cycles through a 6-frame animation: `.  ` → `.. ` → `...` → ` ..` → `  .` → `   `.
/// Optionally prefixed with a label.
///
/// # Example
///
/// ```rust
/// use unit_ui::widgets::ThinkingDots;
/// let dots = ThinkingDots::new().label("Processing");
/// ```
#[derive(Debug, Clone)]
pub struct ThinkingDots {
    frame_index: usize,
    label: String,
    style: StyleToken,
}

impl ThinkingDots {
    /// Creates a new `ThinkingDots` at frame 0.
    pub fn new() -> Self {
        Self {
            frame_index: 0,
            label: String::new(),
            style: StyleToken::default(),
        }
    }

    /// Sets the current animation frame index.
    pub fn frame_index(mut self, index: usize) -> Self {
        self.frame_index = index;
        self
    }

    /// Sets a label shown before the dots.
    pub fn label(mut self, label: impl Into<String>) -> Self {
        self.label = label.into();
        self
    }

    /// Applies a `StyleToken` to the widget.
    pub fn style(mut self, tokens: StyleToken) -> Self {
        self.style = tokens;
        self
    }
}

impl Default for ThinkingDots {
    fn default() -> Self {
        Self::new()
    }
}

impl Widget for ThinkingDots {
    fn render(self, area: Rect, buf: &mut Buffer) {
        (&self).render(area, buf);
    }
}

impl Widget for &ThinkingDots {
    fn render(self, area: Rect, buf: &mut Buffer) {
        if area.width == 0 || area.height == 0 {
            return;
        }

        let frames = [".  ", ".. ", "...", " ..", "  .", "   "];
        let dots = frames[self.frame_index % frames.len()];

        let prefix = if self.label.is_empty() {
            String::new()
        } else {
            format!("{} ", self.label)
        };

        let text = format!("{}{}", prefix, dots);
        let span = Span::styled(text, Style::default().fg(self.style.text_dim));
        span.render(area, buf);
    }
}
