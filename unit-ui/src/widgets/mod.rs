//! Reusable TUI widgets for AI agent CLIs.
//!
//! ## Tiers
//!
//! | Tier | Widgets |
//! |------|---------|
//! | Free | `StreamingText`, `Spinner`, `BasicInput`, `MessageBubble`, `Role`, `StatusBar`, `ConnectionStatus`, `ThinkingDots` |
//! | Pro  | `SlashMenu`, `SlashCommand`, `SlashOption` |
//!
//! Every widget follows the same builder pattern:
//! `.new(...).option_a(val).option_b(val).style(style_token)`.

mod streaming_text;
mod spinner;
mod input;
mod message;
mod status_bar;
mod thinking_dots;
mod slash_menu;

pub use streaming_text::StreamingText;
pub use spinner::Spinner;
pub use input::BasicInput;
pub use message::{MessageBubble, Role};
pub use status_bar::{ConnectionStatus, StatusBar};
pub use thinking_dots::ThinkingDots;
pub use slash_menu::{SlashMenu, SlashCommand, SlashOption};
