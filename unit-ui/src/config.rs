use std::collections::HashMap;
use std::fs;
use std::path::Path;

use ratatui::style::Color;

use crate::style::StyleToken;
use crate::theme::themes;

/// \[Free\] Top-level configuration loaded from `Unit.toml`.
///
/// # Doc aliases
///
/// `configuration`, `settings`
///
/// # Example TOML
///
/// ```toml
/// [theme]
/// schema = "Dracula"
/// [theme.colors]
/// accent = "#ff8800"
/// ```
#[derive(Debug, Clone, serde::Deserialize)]
pub struct UnitConfig {
    #[serde(default)]
    pub theme: ThemeConfig,
}

/// Theme settings within `Unit.toml`.
#[derive(Debug, Clone, Default, serde::Deserialize)]
pub struct ThemeConfig {
    /// Named theme schema (e.g. `"Dracula"`, `"Nord"`). See `themes::from_name`.
    pub schema: Option<String>,
    /// Per-field colour overrides as hex strings (e.g. `{ accent = "#ff8800" }`).
    #[serde(default)]
    pub colors: HashMap<String, String>,
}

fn parse_hex_into_color(hex: &str) -> Option<Color> {
    let hex = hex.trim_start_matches('#');
    if hex.len() != 6 {
        return None;
    }
    let r = u8::from_str_radix(&hex[0..2], 16).ok()?;
    let g = u8::from_str_radix(&hex[2..4], 16).ok()?;
    let b = u8::from_str_radix(&hex[4..6], 16).ok()?;
    Some(Color::Rgb(r, g, b))
}

impl UnitConfig {
    /// Parses a `Unit.toml` file from disk.
    pub fn load<P: AsRef<Path>>(path: P) -> Result<Self, String> {
        let content = fs::read_to_string(path.as_ref())
            .map_err(|e| format!("Failed to read Unit.toml: {e}"))?;
        let config: UnitConfig =
            toml::from_str(&content).map_err(|e| format!("Failed to parse Unit.toml: {e}"))?;
        Ok(config)
    }

    /// Merges the configured schema theme with any hex colour overrides into a
    /// single [`StyleToken`].
    pub fn resolve_style(&self) -> StyleToken {
        let mut token = if let Some(ref schema) = self.theme.schema {
            themes::from_name(schema)
                .map(|t| t.palette)
                .unwrap_or_default()
        } else {
            StyleToken::default()
        };

        for (key, hex) in &self.theme.colors {
            if let Some(color) = parse_hex_into_color(hex) {
                match key.as_str() {
                    "text" => token.text = color,
                    "text_dim" => token.text_dim = color,
                    "accent" => token.accent = color,
                    "surface" => token.surface = color,
                    "error" => token.error = color,
                    "success" => token.success = color,
                    "thinking" => token.thinking = color,
                    "provider" => token.provider = color,
                    _ => {}
                }
            }
        }

        token
    }
}
