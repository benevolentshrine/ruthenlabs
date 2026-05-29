use ratatui::style::Color;

/// \[Free\] A complete set of semantic colours for widget theming.
///
/// # Doc aliases
///
/// `theme token`, `color scheme`, `palette`
///
/// Passed into widgets via the `.style()` builder method. Every widget
/// subscribes to a subset of these fields.
///
/// # Default values (dark theme)
///
/// | Field      | Default        | Usage                         |
/// |------------|----------------|-------------------------------|
/// | `text`     | `#dcdcdc`      | Primary text                  |
/// | `text_dim` | `#787882`      | Secondary/dim text            |
/// | `accent`   | `#4285f4`      | Primary accent (user bubbles) |
/// | `surface`  | `#1e1e24`      | Background                    |
/// | `error`    | `#dc3c3c`      | Error messages                |
/// | `success`  | `#3cc878`      | Success/confirmation          |
/// | `thinking` | `#b4b464`      | Thinking block markers        |
/// | `provider` | `#4285f4`      | Provider badge colour         |
///
/// # Example
///
/// ```rust
/// use unit_ui::style::StyleToken;
/// use ratatui::style::Color;
///
/// let token = StyleToken::builder()
///     .accent(Color::Rgb(255, 100, 100))
///     .build();
/// ```
#[derive(Debug, Clone)]
pub struct StyleToken {
    /// Primary text colour.
    pub text: Color,
    /// Dim/secondary text colour.
    pub text_dim: Color,
    /// Primary accent colour (used for user messages, active elements).
    pub accent: Color,
    /// Background / surface colour.
    pub surface: Color,
    /// Error / danger colour.
    pub error: Color,
    /// Success / confirmation colour (used for assistant messages).
    pub success: Color,
    /// Thinking block / warning colour.
    pub thinking: Color,
    /// Provider / tertiary accent colour.
    pub provider: Color,
}

impl Default for StyleToken {
    fn default() -> Self {
        Self {
            text: Color::Rgb(220, 220, 220),
            text_dim: Color::Rgb(120, 120, 130),
            accent: Color::Rgb(66, 133, 244),
            surface: Color::Rgb(30, 30, 36),
            error: Color::Rgb(220, 60, 60),
            success: Color::Rgb(60, 200, 120),
            thinking: Color::Rgb(180, 180, 100),
            provider: Color::Rgb(66, 133, 244),
        }
    }
}

impl StyleToken {
    /// Returns a builder for constructing a custom `StyleToken`.
    pub fn builder() -> StyleTokenBuilder {
        StyleTokenBuilder::default()
    }
}

/// Builder for [`StyleToken`].
///
/// Create via [`StyleToken::builder()`].
#[derive(Default)]
pub struct StyleTokenBuilder {
    token: StyleToken,
}

impl StyleTokenBuilder {
    /// Sets the primary text colour.
    pub fn text(mut self, color: Color) -> Self {
        self.token.text = color;
        self
    }
    /// Sets the dim text colour.
    pub fn text_dim(mut self, color: Color) -> Self {
        self.token.text_dim = color;
        self
    }
    /// Sets the accent colour.
    pub fn accent(mut self, color: Color) -> Self {
        self.token.accent = color;
        self
    }
    /// Sets the surface/background colour.
    pub fn surface(mut self, color: Color) -> Self {
        self.token.surface = color;
        self
    }
    /// Sets the error colour.
    pub fn error(mut self, color: Color) -> Self {
        self.token.error = color;
        self
    }
    /// Sets the success colour.
    pub fn success(mut self, color: Color) -> Self {
        self.token.success = color;
        self
    }
    /// Sets the thinking block colour.
    pub fn thinking(mut self, color: Color) -> Self {
        self.token.thinking = color;
        self
    }
    /// Sets the provider badge colour.
    pub fn provider(mut self, color: Color) -> Self {
        self.token.provider = color;
        self
    }
    /// Consumes the builder and returns the constructed [`StyleToken`].
    pub fn build(self) -> StyleToken {
        self.token
    }
}
