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

mod approval_prompt;
mod diff_view;
mod input;
mod markdown_block;
mod message;
mod multi_line_input;
mod session_timeline;
mod slash_menu;
mod spinner;
mod status_bar;
mod streaming_text;
mod thinking_block;
mod thinking_dots;
mod tool_call_card;

pub use approval_prompt::{ApprovalPrompt, ApprovalStatus};
pub use diff_view::DiffView;
pub use input::BasicInput;
pub use markdown_block::MarkdownBlock;
pub use message::{MessageBubble, Role};
pub use multi_line_input::MultiLineInput;
pub use session_timeline::{SessionTimeline, TimelineEntry};
pub use slash_menu::{SlashCommand, SlashMenu, SlashOption};
pub use spinner::Spinner;
pub use status_bar::{ConnectionStatus, StatusBar};
pub use streaming_text::StreamingText;
pub use thinking_block::{ThinkingBlock, ThinkingState};
pub use thinking_dots::ThinkingDots;
pub use tool_call_card::{ToolCallCard, ToolStatus};
