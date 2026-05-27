use std::time::Instant;

use ratatui::buffer::Buffer;
use ratatui::layout::Rect;
use ratatui::style::Style;
use ratatui::text::{Line, Span};
use ratatui::widgets::Widget;

use crate::style::StyleToken;

/// Describes the current network state for the status bar indicator.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConnectionStatus {
    /// Backend is reachable.
    Connected,
    /// Backend is unreachable.
    Disconnected,
    /// Connection is in progress.
    Connecting,
}

/// \[Free\] A compact status bar for the top of an AI terminal UI.
///
/// Shows provider name, connection state (with a coloured dot), model name,
/// session elapsed time, and optional token count — all on a single line.
///
/// # Example
///
/// ```rust
/// use std::time::Instant;
/// use unit_ui::widgets::{StatusBar, ConnectionStatus};
/// let bar = StatusBar::new()
///     .provider("Anthropic")
///     .model("claude-sonnet-4")
///     .connection(ConnectionStatus::Connected)
///     .started_at(Instant::now());
/// ```
#[derive(Debug, Clone, Default)]
pub struct StatusBar {
    provider: Option<String>,
    model: Option<String>,
    token_count: Option<u64>,
    connection: Option<ConnectionStatus>,
    started_at: Option<Instant>,
    style: StyleToken,
}

impl StatusBar {
    /// Creates a new empty `StatusBar`.
    pub fn new() -> Self {
        Self {
            provider: None,
            model: None,
            token_count: None,
            connection: None,
            started_at: None,
            style: StyleToken::default(),
        }
    }

    /// Sets the provider name (e.g. "Anthropic", "OpenAI").
    pub fn provider(mut self, name: impl Into<String>) -> Self {
        self.provider = Some(name.into());
        self
    }

    /// Sets the model name (e.g. "claude-sonnet-4").
    pub fn model(mut self, name: impl Into<String>) -> Self {
        self.model = Some(name.into());
        self
    }

    /// Sets the token count to display.
    pub fn token_count(mut self, n: u64) -> Self {
        self.token_count = Some(n);
        self
    }

    /// Applies a `StyleToken` to the widget.
    pub fn style(mut self, tokens: StyleToken) -> Self {
        self.style = tokens;
        self
    }

    /// Sets the connection status indicator.
    pub fn connection(mut self, status: ConnectionStatus) -> Self {
        self.connection = Some(status);
        self
    }

    /// Sets the session start time for the elapsed counter.
    pub fn started_at(mut self, time: Instant) -> Self {
        self.started_at = Some(time);
        self
    }
}

fn connection_dot(status: ConnectionStatus) -> (char, Color) {
    match status {
        ConnectionStatus::Connected => ('●', Color::Rgb(60, 200, 120)),
        ConnectionStatus::Disconnected => ('●', Color::Rgb(220, 60, 60)),
        ConnectionStatus::Connecting => ('●', Color::Rgb(220, 200, 60)),
    }
}

use ratatui::style::Color;

impl Widget for &StatusBar {
    fn render(self, area: Rect, buf: &mut Buffer) {
        let mut parts: Vec<Span> = Vec::new();
        let dimmed = Style::default().fg(self.style.text_dim);
        let accent = Style::default().fg(self.style.accent);

        if let Some(ref provider) = self.provider {
            parts.push(Span::styled("◆ ", accent));
            parts.push(Span::styled(provider.as_str(), dimmed));
        }

        if let Some(ref conn) = self.connection {
            if !parts.is_empty() {
                parts.push(Span::styled("  ", dimmed));
            }
            let (dot, color) = connection_dot(*conn);
            parts.push(Span::styled(format!("{} ", dot), Style::default().fg(color)));
            let label = match conn {
                ConnectionStatus::Connected => "connected",
                ConnectionStatus::Disconnected => "disconnected",
                ConnectionStatus::Connecting => "connecting",
            };
            parts.push(Span::styled(label, dimmed));
        }

        if let Some(ref model) = self.model {
            if !parts.is_empty() {
                parts.push(Span::styled("  │  ", dimmed));
            }
            parts.push(Span::styled(model.as_str(), dimmed));
        }

        if let Some(started) = self.started_at {
            if !parts.is_empty() {
                parts.push(Span::styled("  │  ", dimmed));
            }
            let elapsed = started.elapsed();
            let secs = elapsed.as_secs();
            let mm = secs / 60;
            let ss = secs % 60;
            parts.push(Span::styled(format!("{:02}:{:02}", mm, ss), dimmed));
        }

        if let Some(count) = self.token_count {
            if !parts.is_empty() {
                parts.push(Span::styled("  │  ", dimmed));
            }
            parts.push(Span::styled(format!("{} tokens", count), dimmed));
        }

        if parts.is_empty() {
            return;
        }

        let line = Line::from(parts);
        line.render(area, buf);
    }
}
