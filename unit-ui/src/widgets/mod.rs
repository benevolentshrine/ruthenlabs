//! Reusable TUI widgets for AI agent CLIs.
//!
//! ## Tiers
//!
//! | Tier | Widgets |
//! |------|---------|
//! | Free | `StreamingText`, `Spinner`, `BasicInput`, `MessageBubble`, `Role`, `StatusBar`, `ConnectionStatus`, `ThinkingDots` |
//! | Pro  | `ThinkingBlock`, `ThinkingState`, `ToolCallCard`, `ToolStatus`, `DiffView`, `ApprovalPrompt`, `ApprovalStatus`, `MultiLineInput`, `SessionTimeline`, `TimelineEntry`, `MarkdownBlock` |
//!
//! Every widget follows the same builder pattern:
//! `.new(...).option_a(val).option_b(val).style(style_token)`.

mod streaming_text;
mod spinner;
mod input;
mod message;
mod status_bar;
mod thinking_dots;
mod thinking_block;
mod tool_call_card;
mod diff_view;
mod approval_prompt;
mod multi_line_input;
mod session_timeline;
mod markdown_block;
mod slash_menu;

pub use streaming_text::StreamingText;
pub use spinner::Spinner;
pub use input::BasicInput;
pub use message::{MessageBubble, Role};
pub use status_bar::{ConnectionStatus, StatusBar};
pub use thinking_dots::ThinkingDots;
pub use thinking_block::{ThinkingBlock, ThinkingState};
pub use tool_call_card::{ToolCallCard, ToolStatus};
pub use diff_view::DiffView;
pub use approval_prompt::{ApprovalPrompt, ApprovalStatus};
pub use multi_line_input::MultiLineInput;
pub use session_timeline::{SessionTimeline, TimelineEntry};
pub use markdown_block::MarkdownBlock;
pub use slash_menu::{SlashMenu, SlashCommand, SlashOption};
