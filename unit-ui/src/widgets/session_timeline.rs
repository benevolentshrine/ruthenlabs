use ratatui::buffer::Buffer;
use ratatui::layout::Rect;
use ratatui::style::Style;
use ratatui::text::{Line, Span};
use ratatui::widgets::Widget;

use crate::style::StyleToken;

/// \[Pro\] A single entry in the session timeline.
///
/// # Doc aliases
///
/// `event entry`, `log item`
#[derive(Debug, Clone)]
pub struct TimelineEntry<'a> {
    /// Timestamp or relative time string (e.g. "10:32:15", "+2.3s").
    pub timestamp: &'a str,
    /// A single-character or short icon (e.g. "⚡", "📁", "✓").
    pub icon: &'a str,
    /// The event title (e.g. "read_file", "bash").
    pub title: &'a str,
    /// Optional one-line detail shown below the title.
    pub detail: &'a str,
}

impl<'a> TimelineEntry<'a> {
    /// Creates a new timeline entry.
    pub fn new(timestamp: &'a str, icon: &'a str, title: &'a str, detail: &'a str) -> Self {
        Self {
            timestamp,
            icon,
            title,
            detail,
        }
    }
}

/// \[Pro\] A vertical timeline showing session events in chronological
/// order, similar to the activity views in Hermes and Agent Deck.
///
/// # Doc aliases
///
/// `event log`, `activity feed`, `session log`, `history`
///
/// Renders a scrollable list of entries, each with a timestamp, icon,
/// title, and optional detail line. Entries are connected by a vertical
/// line in the gutter.
///
/// # Example
///
/// ```rust
/// use unit_ui::widgets::{SessionTimeline, TimelineEntry};
///
/// let entries = [
///     TimelineEntry::new("10:32:15", "⚡", "read_file", "src/main.rs"),
///     TimelineEntry::new("10:32:16", "✓", "edit_file", "2 insertions, 0 deletions"),
/// ];
/// let timeline = SessionTimeline::new().entries(&entries);
/// ```
#[derive(Debug, Clone)]
pub struct SessionTimeline<'a> {
    entries: &'a [TimelineEntry<'a>],
    scroll_offset: u16,
    style: StyleToken,
}

impl<'a> SessionTimeline<'a> {
    /// Creates a new `SessionTimeline`.
    pub fn new() -> Self {
        Self {
            entries: &[],
            scroll_offset: 0,
            style: StyleToken::default(),
        }
    }

    /// Sets the timeline entries to display.
    pub fn entries(mut self, entries: &'a [TimelineEntry<'a>]) -> Self {
        self.entries = entries;
        self
    }

    /// Sets the vertical scroll offset (number of entries to skip).
    pub fn scroll_offset(mut self, n: u16) -> Self {
        self.scroll_offset = n;
        self
    }

    /// Applies a `StyleToken`.
    pub fn style(mut self, tokens: StyleToken) -> Self {
        self.style = tokens;
        self
    }
}

impl Default for SessionTimeline<'_> {
    fn default() -> Self {
        Self::new()
    }
}

impl Widget for SessionTimeline<'_> {
    fn render(self, area: Rect, buf: &mut Buffer) {
        (&self).render(area, buf);
    }
}

impl Widget for &SessionTimeline<'_> {
    fn render(self, area: Rect, buf: &mut Buffer) {
        if area.width == 0 || area.height == 0 {
            return;
        }

        let dimmed = Style::default().fg(self.style.text_dim);
        let text = Style::default().fg(self.style.text);
        let accent = Style::default().fg(self.style.accent);
        let line_color = Style::default().fg(self.style.text_dim);

        let gutter_width = 3u16; // " │ " for the timeline line
        let ts_width = 10u16; // fixed timestamp width
        let content_x = area.x + gutter_width;
        let ts_x = content_x;
        let title_x = ts_x + ts_width + 1;

        let mut y = area.y;
        let end = area.y + area.height;

        for entry in self.entries.iter().skip(self.scroll_offset as usize) {
            if y >= end {
                break;
            }

            // Timeline connector
            let connector = Span::styled(" │ ", line_color);
            connector.render(
                Rect {
                    x: area.x,
                    y,
                    width: gutter_width,
                    height: 1,
                },
                buf,
            );

            // Timestamp
            let ts = Span::styled(entry.timestamp, dimmed);
            ts.render(
                Rect {
                    x: content_x,
                    y,
                    width: ts_width,
                    height: 1,
                },
                buf,
            );

            // Icon + title
            let icon = Span::styled(entry.icon, accent);
            let title = Span::styled(entry.title, text);
            let title_line = Line::from(vec![icon, Span::styled(" ", text), title]);
            title_line.render(
                Rect {
                    x: title_x,
                    y,
                    width: area.width.saturating_sub(title_x - area.x),
                    height: 1,
                },
                buf,
            );
            y += 1;

            // Optional detail (indented)
            if !entry.detail.is_empty() && y < end {
                let detail = Span::styled(format!("   {}", entry.detail), dimmed);
                detail.render(
                    Rect {
                        x: ts_x,
                        y,
                        width: area.width.saturating_sub(ts_x - area.x),
                        height: 1,
                    },
                    buf,
                );
                y += 1;
            }

            // Separator between entries
            if y < end {
                let blank = Span::styled("", dimmed);
                blank.render(
                    Rect {
                        x: area.x,
                        y,
                        width: area.width,
                        height: 1,
                    },
                    buf,
                );
                y += 1;
            }
        }
    }
}
