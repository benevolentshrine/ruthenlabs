//! # Unit-UI — AI terminal widgets for Ratatui
//!
//! A component library of terminal UI widgets designed for building AI agent
//! command-line interfaces. Each widget follows a consistent builder pattern
//! and accepts a [`StyleToken`](crate::style::StyleToken) for theming.
//!
//! ## Quick start
//!
//! ```rust
//! use unit_ui::prelude::*;
//!
//! let style = StyleToken::builder()
//!     .accent(ratatui::style::Color::Rgb(66, 133, 244))
//!     .build();
//!
//! let input = BasicInput::new("").placeholder("Ask anything...");
//! let spinner = Spinner::new().label("Thinking...");
//! ```

pub mod animation;
pub mod config;
pub mod style;
pub mod theme;
pub mod widgets;

/// Convenience re-exports for all commonly used types.
///
/// ```rust
/// use unit_ui::prelude::*;
/// ```
pub mod prelude {
    pub use crate::animation::spinners;
    pub use crate::config::UnitConfig;
    pub use crate::style::StyleToken;
    pub use crate::theme::palette;
    pub use crate::theme::providers;
    pub use crate::theme::themes;
    pub use crate::widgets::*;
}
