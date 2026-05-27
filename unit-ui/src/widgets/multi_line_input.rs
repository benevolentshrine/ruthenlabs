use ratatui::buffer::Buffer;
use ratatui::layout::Rect;
use ratatui::style::Style;
use ratatui::text::Span;
use ratatui::widgets::Widget;

use crate::style::StyleToken;

/// \[Pro\] A multi-line text input area with line numbers.
///
/// # Doc aliases
///
/// `text editor`, `textarea`, `code input`, `multi-line`
///
/// Renders a text area with optional line numbers in the left gutter and
/// a highlighted cursor line. The caller manages the text buffer, scroll
/// offset, and cursor position — this is the display layer.
///
/// # Example
///
/// ```rust
/// use unit_ui::widgets::MultiLineInput;
///
/// let input = MultiLineInput::new()
///     .text("fn main() {\n    println!(\"hello\");\n}")
///     .cursor_line(1)
///     .show_line_numbers(true);
/// ```
#[derive(Debug, Clone)]
pub struct MultiLineInput<'a> {
    text: &'a str,
    cursor_line: u16,
    show_line_numbers: bool,
    placeholder: &'a str,
    style: StyleToken,
}

impl<'a> MultiLineInput<'a> {
    /// Creates a new `MultiLineInput`.
    pub fn new() -> Self {
        Self {
            text: "",
            cursor_line: 0,
            show_line_numbers: true,
            placeholder: "",
            style: StyleToken::default(),
        }
    }

    /// Sets the text content.
    pub fn text(mut self, text: &'a str) -> Self { self.text = text; self }
    /// Sets the cursor line (0-indexed) for line highlight.
    pub fn cursor_line(mut self, n: u16) -> Self { self.cursor_line = n; self }
    /// Toggles line number gutter visibility.
    pub fn show_line_numbers(mut self, show: bool) -> Self { self.show_line_numbers = show; self }
    /// Sets placeholder text when the input is empty.
    pub fn placeholder(mut self, text: &'a str) -> Self { self.placeholder = text; self }
    /// Applies a `StyleToken`.
    pub fn style(mut self, tokens: StyleToken) -> Self { self.style = tokens; self }
}

impl Default for MultiLineInput<'_> {
    fn default() -> Self { Self::new() }
}

impl Widget for &MultiLineInput<'_> {
    fn render(self, area: Rect, buf: &mut Buffer) {
        if area.width == 0 || area.height == 0 { return; }

        let dimmed = Style::default().fg(self.style.text_dim);
        let accent = Style::default().fg(self.style.accent);
        let text_style = Style::default().fg(self.style.text);
        let lines: Vec<&str> = if self.text.is_empty() {
            vec![]
        } else {
            self.text.lines().collect()
        };

        // Calculate gutter width
        let gutter_width = if self.show_line_numbers && !lines.is_empty() {
            let digits = (lines.len() as f64).log10().ceil() as u16 + 1;
            digits.max(3) + 1
        } else {
            0
        };

        let content_x = area.x + gutter_width;
        let content_w = area.width.saturating_sub(gutter_width);

        let end = area.y + area.height;

        for (y, (i, line_text)) in (area.y..).zip(lines.iter().enumerate()) {
            if y >= end { break; }
            let line_num = i + 1;
            let is_cursor = i as u16 == self.cursor_line;

            // Gutter
            if self.show_line_numbers && gutter_width > 0 {
                let gutter_style = if is_cursor { accent } else { dimmed };
                let num_str = format!("{:>width$}", line_num, width = (gutter_width - 1) as usize);
                let gutter = Span::styled(format!("{} ", num_str), gutter_style);
                gutter.render(Rect { x: area.x, y, width: gutter_width, height: 1 }, buf);
            }

            // Content line
            if content_w > 0 {
                if is_cursor {
                    let bg = Style::default().bg(ratatui::style::Color::Rgb(45, 45, 55));
                    let full = format!("{:width$}", "", width = content_w as usize);
                    Span::styled(full, bg).render(Rect { x: content_x, y, width: content_w, height: 1 }, buf);
                }
                let span = Span::styled(*line_text, text_style);
                span.render(Rect { x: content_x, y, width: content_w, height: 1 }, buf);
            }

        }

        // Placeholder when empty
        if lines.is_empty() && !self.placeholder.is_empty() {
            Span::styled(self.placeholder, dimmed).render(area, buf);
        }
    }
}
