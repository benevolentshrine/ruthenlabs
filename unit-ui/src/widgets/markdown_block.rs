use ratatui::buffer::Buffer;
use ratatui::layout::Rect;
use ratatui::style::{Modifier, Style};
use ratatui::text::{Line, Span, Text};
use ratatui::widgets::{Paragraph, Widget, Wrap};

use crate::style::StyleToken;

/// \[Pro\] A simple markdown renderer for assistant messages.
///
/// # Doc aliases
///
/// `markdown renderer`, `formatted text`, `rich text`
///
/// Renders basic markdown formatting without a parser dependency:
///
/// - `# ## ###` headings → bold + accent colour
/// - `` `code` `` inline → dim background highlight
/// - ` ``` ``` ` fenced code blocks → dimmed monospace block
/// - `- *` list items → indented with bullet
/// - `**bold**` → bold modifier
///
/// The rendering is line-oriented and suitable for LLM responses.
///
/// # Example
///
/// ```rust
/// use unit_ui::widgets::MarkdownBlock;
///
/// let md = MarkdownBlock::new()
///     .content("# Hello\nThis is **bold** text.\n- list item");
/// ```
#[derive(Debug, Clone)]
pub struct MarkdownBlock<'a> {
    content: &'a str,
    style: StyleToken,
}

impl<'a> MarkdownBlock<'a> {
    /// Creates a new `MarkdownBlock`.
    pub fn new() -> Self {
        Self { content: "", style: StyleToken::default() }
    }

    /// Sets the markdown content to render.
    pub fn content(mut self, content: &'a str) -> Self { self.content = content; self }
    /// Applies a `StyleToken`.
    pub fn style(mut self, tokens: StyleToken) -> Self { self.style = tokens; self }
}

impl Default for MarkdownBlock<'_> {
    fn default() -> Self { Self::new() }
}

fn parse_inline(text: &str, base: Style, dimmed: Style) -> Line<'_> {
    let mut spans = Vec::new();
    let mut remaining = text;

    while !remaining.is_empty() {
        // **bold**
        if let Some(start) = remaining.find("**") {
            let before = &remaining[..start];
            if !before.is_empty() {
                spans.push(Span::styled(before.to_string(), base));
            }
            let after = &remaining[start + 2..];
            if let Some(end) = after.find("**") {
                let bold_text = &after[..end];
                spans.push(Span::styled(
                    bold_text.to_string(),
                    base.add_modifier(Modifier::BOLD),
                ));
                remaining = &after[end + 2..];
            } else {
                spans.push(Span::styled("**".to_string(), base));
                remaining = after;
            }
            continue;
        }

        // `inline code`
        if let Some(start) = remaining.find('`') {
            let before = &remaining[..start];
            if !before.is_empty() {
                spans.push(Span::styled(before.to_string(), base));
            }
            let after = &remaining[start + 1..];
            if let Some(end) = after.find('`') {
                let code_text = &after[..end];
                spans.push(Span::styled(code_text.to_string(), dimmed));
                remaining = &after[end + 1..];
            } else {
                spans.push(Span::styled("`".to_string(), base));
                remaining = after;
            }
            continue;
        }

        spans.push(Span::styled(remaining.to_string(), base));
        break;
    }

    Line::from(spans)
}

impl Widget for MarkdownBlock<'_> {
    fn render(self, area: Rect, buf: &mut Buffer) { (&self).render(area, buf); }
}

impl Widget for &MarkdownBlock<'_> {
    fn render(self, area: Rect, buf: &mut Buffer) {
        if area.width == 0 || area.height == 0 { return; }

        let text_style = Style::default().fg(self.style.text);
        let dimmed = Style::default().fg(self.style.text_dim);
        let accent = Style::default().fg(self.style.accent);
        let heading_style = accent.add_modifier(Modifier::BOLD);

        let mut styled_lines: Vec<Line> = Vec::new();
        let mut in_code_block = false;

        for raw in self.content.lines() {
            // Fenced code blocks
            if raw.trim().starts_with("```") {
                in_code_block = !in_code_block;
                styled_lines.push(Line::from(Span::styled("```", dimmed)));
                continue;
            }

            if in_code_block {
                styled_lines.push(Line::from(Span::styled(raw, dimmed)));
                continue;
            }

            // Headings
            if let Some(rest) = raw.strip_prefix("### ") {
                styled_lines.push(Line::from(Span::styled(rest, heading_style)));
                continue;
            }
            if let Some(rest) = raw.strip_prefix("## ") {
                styled_lines.push(Line::from(Span::styled(rest, heading_style)));
                continue;
            }
            if let Some(rest) = raw.strip_prefix("# ") {
                styled_lines.push(Line::from(Span::styled(rest, heading_style)));
                continue;
            }

            // List items
            if raw.starts_with("- ") || raw.starts_with("* ") {
                let text = &raw[2..];
                let prefix = Span::styled(" • ", accent);
                let line = parse_inline(text, text_style, dimmed);
            let mut parts = vec![prefix];
            parts.extend(line.spans);
            styled_lines.push(Line::from(parts));
            continue;
        }

        // Numbered list
        if let Some(rest) = raw.strip_prefix(|c: char| c.is_ascii_digit())
            .and_then(|r| r.strip_prefix(". "))
        {
            let prefix = Span::styled("   ", dimmed);
            let line = parse_inline(rest, text_style, dimmed);
            let mut parts = vec![prefix];
            parts.extend(line.spans);
                styled_lines.push(Line::from(parts));
                continue;
            }

            // Regular paragraph with inline formatting
            if raw.trim().is_empty() {
                styled_lines.push(Line::from(""));
            } else {
                styled_lines.push(parse_inline(raw, text_style, dimmed));
            }
        }

        let text = Text::from(styled_lines);
        let para = Paragraph::new(text).wrap(Wrap { trim: false });
        para.render(area, buf);
    }
}
