use ratatui::buffer::Buffer;
use ratatui::layout::Rect;
use ratatui::style::Style;
use ratatui::text::{Line, Span};
use ratatui::widgets::Widget;

use crate::style::StyleToken;

/// \[Free\] A single-line text input with optional placeholder.
///
/// # Doc aliases
///
/// `text field`, `prompt`, `command input`
///
/// Renders a `>` prompt prefix followed by the current value. When focused,
/// the prefix uses the accent color; when unfocused it uses the dim color.
///
/// # Example
///
/// ```rust
/// use unit_ui::widgets::BasicInput;
/// let input = BasicInput::new("").placeholder("Type something...");
/// ```
#[derive(Debug, Clone)]
pub struct BasicInput<'a> {
    value: &'a str,
    placeholder: Option<&'a str>,
    cursor_pos: usize,
    focused: bool,
    style: StyleToken,
}

impl<'a> BasicInput<'a> {
    /// Creates a new `BasicInput` with an initial value.
    pub fn new(value: &'a str) -> Self {
        Self {
            value,
            placeholder: None,
            cursor_pos: value.len(),
            focused: true,
            style: StyleToken::default(),
        }
    }

    /// Sets the placeholder text shown when the input is empty.
    pub fn placeholder(mut self, text: &'a str) -> Self {
        self.placeholder = Some(text);
        self
    }

    /// Sets the cursor position within the value.
    pub fn cursor_pos(mut self, pos: usize) -> Self {
        self.cursor_pos = pos.min(self.value.len());
        self
    }

    /// Sets whether the input visually shows as focused.
    pub fn focused(mut self, focused: bool) -> Self {
        self.focused = focused;
        self
    }

    /// Applies a `StyleToken` to the widget.
    pub fn style(mut self, tokens: StyleToken) -> Self {
        self.style = tokens;
        self
    }

    /// Returns the current input value.
    pub fn value(&self) -> &'a str {
        self.value
    }

    /// Returns the cursor position.
    pub fn cursor(&self) -> usize {
        self.cursor_pos
    }
}

impl Widget for BasicInput<'_> {
    fn render(self, area: Rect, buf: &mut Buffer) { (&self).render(area, buf); }
}

impl Widget for &BasicInput<'_> {
    fn render(self, area: Rect, buf: &mut Buffer) {
        let border = Style::default().fg(if self.focused {
            self.style.accent
        } else {
            self.style.text_dim
        });

        let prefix = Span::styled("> ", border);

        let text = if self.value.is_empty() {
            if let Some(placeholder) = self.placeholder {
                Span::styled(placeholder, Style::default().fg(self.style.text_dim))
            } else {
                return;
            }
        } else {
            Span::styled(self.value, Style::default().fg(self.style.text))
        };

        let line = Line::from(vec![prefix, text]);
        line.render(area, buf);
    }
}
