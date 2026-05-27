use ratatui::style::Color;

/// Generate a full `StyleToken` from a single accent colour.
///
/// All other fields use the default (dark theme) values.
pub fn from_accent(accent: Color) -> super::super::style::StyleToken {
    super::super::style::StyleToken::builder()
        .accent(accent)
        .build()
}

/// Returns the default dark palette.
pub fn dark() -> super::super::style::StyleToken {
    super::super::style::StyleToken::default()
}

/// Returns a light background palette suitable for daytime terminals.
pub fn light() -> super::super::style::StyleToken {
    super::super::style::StyleToken::builder()
        .text(Color::Rgb(30, 30, 36))
        .text_dim(Color::Rgb(120, 120, 130))
        .accent(Color::Rgb(66, 133, 244))
        .surface(Color::Rgb(240, 240, 245))
        .error(Color::Rgb(200, 40, 40))
        .success(Color::Rgb(40, 160, 80))
        .thinking(Color::Rgb(140, 140, 60))
        .provider(Color::Rgb(66, 133, 244))
        .build()
}
