use ratatui::buffer::Buffer;
use ratatui::layout::Rect;
use ratatui::style::Style;
use ratatui::text::{Line, Span};
use ratatui::widgets::Widget;

use crate::animation::spinners;
use crate::style::StyleToken;

/// \[Free\] An animated spinner for indicating progress.
///
/// Cycles through a set of frame strings (default: braille dots). An optional
/// label is rendered alongside the spinner.
///
/// # Example
///
/// ```rust
/// use unit_ui::widgets::Spinner;
/// let spinner = Spinner::new().label("Loading...");
/// ```
#[derive(Debug, Clone)]
pub struct Spinner {
    frame_index: usize,
    frames: Vec<&'static str>,
    label: Option<String>,
    style: StyleToken,
}

impl Default for Spinner {
    fn default() -> Self {
        Self {
            frame_index: 0,
            frames: spinners::braille(),
            label: None,
            style: StyleToken::default(),
        }
    }
}

impl Spinner {
    /// Creates a new `Spinner` with default braille frames.
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets the current frame index. Wraps around using modulo.
    pub fn frame_index(mut self, n: usize) -> Self {
        self.frame_index = n % self.frames.len();
        self
    }

    /// Replaces the frame set with a custom animation sequence.
    pub fn frames(mut self, set: Vec<&'static str>) -> Self {
        self.frames = set;
        self.frame_index = 0;
        self
    }

    /// Sets a label displayed to the right of the spinner.
    pub fn label(mut self, text: impl Into<String>) -> Self {
        self.label = Some(text.into());
        self
    }

    /// Applies a `StyleToken` to the widget.
    pub fn style(mut self, tokens: StyleToken) -> Self {
        self.style = tokens;
        self
    }
}

impl Widget for &Spinner {
    fn render(self, area: Rect, buf: &mut Buffer) {
        if area.width == 0 {
            return;
        }

        let frame = self.frames[self.frame_index];
        let accent = Style::default().fg(self.style.accent);

        if let Some(ref label) = self.label {
            let dimmed = Style::default().fg(self.style.text_dim);
            let line = Line::from(vec![
                Span::styled(frame, accent),
                Span::styled(" ", dimmed),
                Span::styled(label.as_str(), dimmed),
            ]);
            line.render(area, buf);
        } else {
            let line = Line::from(Span::styled(frame, accent));
            line.render(area, buf);
        }
    }
}
