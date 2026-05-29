use ratatui::buffer::Buffer;
use ratatui::layout::Rect;
use ratatui::style::Style;
use ratatui::text::Text;
use ratatui::widgets::{Paragraph, Widget, Wrap};

use crate::style::StyleToken;

/// \[Free\] A chat message rendered as a paragraph colored by sender role.
///
/// # Doc aliases
///
/// `chat message`, `bubble`, `conversation`
///
/// Uses `Role::User` → accent color, `Role::Assistant` → success color,
/// `Role::System` → dim color.
///
/// # Example
///
/// ```rust
/// use unit_ui::widgets::{MessageBubble, Role};
/// let bubble = MessageBubble::new("Hello!", Role::User);
/// ```
#[derive(Debug, Clone)]
pub struct MessageBubble<'a> {
    content: &'a str,
    role: Role,
    style: StyleToken,
}

/// Identifies the sender of a message.
///
/// # Doc aliases
///
/// `sender`, `participant`
///
/// Maps to different colours in the active `StyleToken`:
/// - `User` → `.accent`
/// - `Assistant` → `.success`
/// - `System` → `.text_dim`
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Role {
    /// The end user.
    User,
    /// The AI model.
    Assistant,
    /// A system-level status message.
    System,
}

impl<'a> MessageBubble<'a> {
    /// Creates a new `MessageBubble` with content and a role.
    pub fn new(content: &'a str, role: Role) -> Self {
        Self {
            content,
            role,
            style: StyleToken::default(),
        }
    }

    /// Applies a `StyleToken` to the widget.
    pub fn style(mut self, tokens: StyleToken) -> Self {
        self.style = tokens;
        self
    }
}

impl Widget for MessageBubble<'_> {
    fn render(self, area: Rect, buf: &mut Buffer) {
        (&self).render(area, buf);
    }
}

impl Widget for &MessageBubble<'_> {
    fn render(self, area: Rect, buf: &mut Buffer) {
        let color = match self.role {
            Role::User => self.style.accent,
            Role::Assistant => self.style.success,
            Role::System => self.style.text_dim,
        };
        let styled = Text::styled(self.content, Style::default().fg(color));
        Paragraph::new(styled)
            .wrap(Wrap { trim: false })
            .render(area, buf);
    }
}
