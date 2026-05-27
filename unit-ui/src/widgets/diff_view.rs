use ratatui::buffer::Buffer;
use ratatui::layout::Rect;
use ratatui::style::Style;
use ratatui::text::{Line, Span, Text};
use ratatui::widgets::{Paragraph, Widget, Wrap};

use crate::style::StyleToken;

/// \[Pro\] A unified diff viewer with syntax-colored additions and removals.
///
/// # Doc aliases
///
/// `diff viewer`, `patch display`, `code diff`, `unified diff`
///
/// Parses unified diff output and renders each line with the appropriate
/// colour: green for additions (`+`), red for removals (`-`), cyan for
/// hunk headers (`@@`), and dim for context lines. An optional file path
/// is displayed as a header above the diff.
///
/// # Example
///
/// ```rust
/// use unit_ui::widgets::DiffView;
///
/// let diff = DiffView::new()
///     .file("src/main.rs")
///     .diff("@@ -1,3 +1,4 @@\n-old line\n+new line\n context");
/// ```
#[derive(Debug, Clone)]
pub struct DiffView<'a> {
    diff: &'a str,
    file: Option<&'a str>,
    style: StyleToken,
}

impl<'a> DiffView<'a> {
    /// Creates a new `DiffView`.
    pub fn new() -> Self {
        Self { diff: "", file: None, style: StyleToken::default() }
    }

    /// Sets the unified diff text content.
    pub fn diff(mut self, diff: &'a str) -> Self { self.diff = diff; self }
    /// Optionally sets the file path shown as a header.
    pub fn file(mut self, path: &'a str) -> Self { self.file = Some(path); self }
    /// Applies a `StyleToken`.
    pub fn style(mut self, tokens: StyleToken) -> Self { self.style = tokens; self }
}

impl Default for DiffView<'_> {
    fn default() -> Self { Self::new() }
}

impl Widget for &DiffView<'_> {
    fn render(self, area: Rect, buf: &mut Buffer) {
        if area.width == 0 || area.height == 0 { return; }

        let dimmed = Style::default().fg(self.style.text_dim);
        let add = Style::default().fg(self.style.success);
        let del = Style::default().fg(self.style.error);
        let hdr = Style::default().fg(self.style.thinking);

        let mut lines: Vec<Line> = Vec::new();

        if let Some(file) = self.file {
            let parts = vec![
                Span::styled("━━━ ", dimmed),
                Span::styled(file, Style::default().fg(self.style.accent).add_modifier(ratatui::style::Modifier::BOLD)),
                Span::styled(" ━━━", dimmed),
            ];
            lines.push(Line::from(parts));
        }

        for raw in self.diff.lines() {
            let (style, prefix) = if raw.starts_with("@@") {
                (hdr, None)
            } else if raw.starts_with('+') {
                (add, Some('+'))
            } else if raw.starts_with('-') {
                (del, Some('-'))
            } else {
                (dimmed, Some(' '))
            };

            let span = if let Some(p) = prefix {
                let content = if raw.len() > 1 { &raw[1..] } else { "" };
                Span::styled(format!("{}{}", p, content), style)
            } else {
                Span::styled(raw, style)
            };
            lines.push(Line::from(span));
        }

        let text = Text::from(lines);
        let para = Paragraph::new(text).wrap(Wrap { trim: false });
        para.render(area, buf);
    }
}
