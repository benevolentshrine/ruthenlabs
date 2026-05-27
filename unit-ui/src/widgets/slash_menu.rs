use ratatui::buffer::Buffer;
use ratatui::layout::Rect;
use ratatui::style::{Modifier, Style};
use ratatui::text::{Line, Span, Text};
use ratatui::widgets::{Block, Borders, Clear, Paragraph, Widget};

use crate::style::StyleToken;

/// A selectable option within a sub-menu (e.g. model names, theme names).
///
/// # Example
///
/// ```rust
/// use unit_ui::widgets::SlashOption;
/// let opt = SlashOption::new("claude-sonnet-4", "Anthropic Claude Sonnet 4");
/// ```
#[derive(Debug, Clone)]
pub struct SlashOption {
    /// The short key/identifier for this option.
    pub name: &'static str,
    /// A human-readable description of this option.
    pub description: &'static str,
}

impl SlashOption {
    /// Creates a new `SlashOption`.
    pub const fn new(name: &'static str, description: &'static str) -> Self {
        Self { name, description }
    }
}

/// A slash command shown in the menu (e.g. `/theme`, `/help`).
///
/// # Example
///
/// ```rust
/// use unit_ui::widgets::SlashCommand;
/// let cmd = SlashCommand::new("theme", "Change the UI theme");
/// ```
#[derive(Debug, Clone)]
pub struct SlashCommand {
    /// The command name (without leading `/`).
    pub name: &'static str,
    /// A short description shown next to the name.
    pub description: &'static str,
}

impl SlashCommand {
    /// Creates a new `SlashCommand`.
    pub const fn new(name: &'static str, description: &'static str) -> Self {
        Self { name, description }
    }
}

/// \[Pro\] A popup menu that lists slash commands with optional sub-menus.
///
/// Supports filtering by typed prefix, keyboard navigation, and a "Back"
/// item when showing sub-menu options.
///
/// # Example
///
/// ```rust
/// use unit_ui::widgets::{SlashMenu, SlashCommand};
/// let cmds = [SlashCommand::new("help", "Show help")];
/// let menu = SlashMenu::new(&cmds).visible(true);
/// ```
#[derive(Debug, Clone)]
pub struct SlashMenu<'a> {
    commands: &'a [SlashCommand],
    options: &'a [SlashOption],
    filter: String,
    selected: usize,
    visible: bool,
    max_visible: usize,
    label: &'a str,
    style: StyleToken,
    option_mode: bool,
}

impl Default for SlashMenu<'_> {
    fn default() -> Self {
        Self {
            commands: &[],
            options: &[],
            filter: String::new(),
            selected: 0,
            visible: false,
            max_visible: 10,
            label: "Commands",
            style: StyleToken::default(),
            option_mode: false,
        }
    }
}

impl<'a> SlashMenu<'a> {
    /// Creates a new `SlashMenu` with the given command list.
    pub fn new(commands: &'a [SlashCommand]) -> Self {
        Self {
            commands,
            ..Default::default()
        }
    }

    /// Replaces the command list.
    pub fn commands(mut self, commands: &'a [SlashCommand]) -> Self {
        self.commands = commands;
        self
    }

    /// Sets the filter text. Commands are matched by name (case-insensitive).
    pub fn filter(mut self, text: impl Into<String>) -> Self {
        let val = text.into();
        self.selected = 0;
        self.filter = val;
        self
    }

    /// Moves selection to the next item (wraps around).
    pub fn select_next(mut self) -> Self {
        let count = self.items().len();
        if count > 0 {
            self.selected = (self.selected + 1) % count;
        }
        self
    }

    /// Moves selection to the previous item (wraps around).
    pub fn select_prev(mut self) -> Self {
        let count = self.items().len();
        if count > 0 {
            self.selected = (self.selected + count - 1) % count;
        }
        self
    }

    /// Sets the selected index directly.
    pub fn selected(mut self, index: usize) -> Self {
        self.selected = index;
        self
    }

    /// Shows or hides the menu.
    pub fn visible(mut self, v: bool) -> Self {
        self.visible = v;
        self
    }

    /// Sets the maximum number of visible items before scrolling.
    pub fn max_visible(mut self, n: usize) -> Self {
        self.max_visible = n.max(1);
        self
    }

    /// Sets the header label text (e.g. "Commands" or "Models").
    pub fn label(mut self, label: &'a str) -> Self {
        self.label = label;
        self
    }

    /// Applies a `StyleToken` to the widget.
    pub fn style(mut self, tokens: StyleToken) -> Self {
        self.style = tokens;
        self
    }

    /// Switches to sub-menu mode displaying the given options.
    ///
    /// An automatic "Back" item is prepended for navigation.
    pub fn show_options(mut self, options: &'a [SlashOption]) -> Self {
        self.option_mode = true;
        self.options = options;
        if !options.is_empty() {
            self.selected = self.selected.min(options.len());
        }
        self
    }

    /// Switches back to the main command list view.
    pub fn show_commands(mut self) -> Self {
        self.option_mode = false;
        self.selected = 0;
        self.filter.clear();
        self
    }

    /// Returns `true` if the menu is set to visible.
    pub fn is_visible(&self) -> bool {
        self.visible
    }

    /// Returns `true` when showing option sub-menus (not the main command list).
    pub fn is_option_mode(&self) -> bool {
        self.option_mode
    }

    /// Returns the currently selected command, if in command mode.
    pub fn selected_command(&self) -> Option<&'a SlashCommand> {
        if self.option_mode {
            return None;
        }
        self.commands.get(self.selected.min(self.commands.len().saturating_sub(1)))
    }

    /// Returns the currently selected option, if in option mode.
    /// Returns `None` when "Back" is selected.
    pub fn selected_option(&self) -> Option<&'a SlashOption> {
        if !self.option_mode {
            return None;
        }
        let idx = if self.selected == 0 { return None } else { self.selected - 1 };
        self.options.get(idx.min(self.options.len().saturating_sub(1)))
    }

    /// Returns `true` when "Back" is the selected item in option mode.
    pub fn is_back_selected(&self) -> bool {
        self.option_mode && self.selected == 0
    }

    fn items(&self) -> Vec<MenuItem<'a>> {
        if self.option_mode {
            let mut items: Vec<MenuItem> = self.matches_options()
                .into_iter()
                .map(MenuItem::Option)
                .collect();
            items.insert(0, MenuItem::Back);
            items
        } else {
            self.matches_commands()
                .into_iter()
                .map(MenuItem::Command)
                .collect()
        }
    }

    fn matches_commands(&self) -> Vec<&'a SlashCommand> {
        if self.filter.is_empty() || self.filter == "/" {
            return self.commands.iter().collect();
        }
        let f = self.filter.trim_start_matches('/').to_lowercase();
        self.commands
            .iter()
            .filter(|c| c.name.to_lowercase().contains(&f))
            .collect()
    }

    fn matches_options(&self) -> Vec<&'a SlashOption> {
        if self.options.is_empty() {
            return vec![];
        }
        if self.filter.is_empty() {
            return self.options.iter().collect();
        }
        let f = self.filter.to_lowercase();
        self.options
            .iter()
            .filter(|o| o.name.to_lowercase().contains(&f))
            .collect()
    }
}

#[derive(Debug)]
enum MenuItem<'a> {
    Back,
    Command(&'a SlashCommand),
    Option(&'a SlashOption),
}

impl Widget for &SlashMenu<'_> {
    fn render(self, area: Rect, buf: &mut Buffer) {
        if !self.visible || area.width < 20 || area.height < 3 {
            return;
        }

        let items = self.items();
        if items.is_empty() {
            return;
        }



        let accent = Style::default().fg(self.style.accent);
        let text_dim = Style::default().fg(self.style.text_dim);
        let selected_text = Style::default()
            .fg(self.style.text)
            .bg(self.style.accent)
            .add_modifier(Modifier::BOLD);
        let selected_bg = Style::default().bg(self.style.accent);
        let display_label = format!(" {} ", self.label);

        let popup_width = area.width.min(50);
        let popup_height = (items.len().min(self.max_visible) as u16 + 2).min(area.height);
        let x = area.x;
        let y = area.y;

        let popup_area = Rect { x, y, width: popup_width, height: popup_height };

        if popup_area.right() > area.right() || popup_area.bottom() > area.bottom() {
            return;
        }

        Clear.render(popup_area, buf);

        let block = Block::default()
            .borders(Borders::ALL)
            .border_style(accent)
            .title(Line::from(Span::styled(display_label, text_dim)));

        let inner = block.inner(popup_area);
        block.render(popup_area, buf);

        let scroll_offset = if self.selected >= self.max_visible {
            self.selected - self.max_visible + 1
        } else {
            0
        };

        let visible_items: Vec<_> = items
            .iter()
            .skip(scroll_offset)
            .take(self.max_visible)
            .collect();

        let mut y_cursor = inner.top();
        for (i, item) in visible_items.iter().enumerate() {
            if y_cursor >= inner.bottom() {
                break;
            }
            let idx = scroll_offset + i;
            let is_selected = idx == self.selected;

            let line_area = Rect {
                x: inner.x,
                y: y_cursor,
                width: inner.width,
                height: 1,
            };

            if is_selected {
                buf.set_style(line_area, selected_bg);
            }

            let name_style = if is_selected { selected_text } else { accent };
            let desc_style = if is_selected { selected_text } else { text_dim };

            let prefix = if is_selected { "▶ " } else { "  " };
            let line = match item {
                MenuItem::Back => {
                    Line::from(vec![
                        Span::styled(format!("{}.. Back", prefix), name_style),
                    ])
                }
                MenuItem::Command(cmd) => {
                    Line::from(vec![
                        Span::styled(format!("{}{}", prefix, cmd.name), name_style),
                        Span::styled(" — ", desc_style),
                        Span::styled(cmd.description, desc_style),
                    ])
                }
                MenuItem::Option(opt) => {
                    Line::from(vec![
                        Span::styled(format!("{}{}", prefix, opt.name), name_style),
                        Span::styled(" — ", desc_style),
                        Span::styled(opt.description, desc_style),
                    ])
                }
            };
            line.render(line_area, buf);
            y_cursor += 1;
        }

        if items.len() > self.max_visible {
            let scroll_text = format!(" {} / {} ", self.selected + 1, items.len());
            let scroll_area = Rect {
                x: inner.x,
                y: inner.bottom().saturating_sub(1),
                width: inner.width,
                height: 1,
            };
            Paragraph::new(Text::from(Span::styled(scroll_text, text_dim)))
                .render(scroll_area, buf);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_submenu_selection_moves_off_back() {
        let cmds = [
            SlashCommand::new("theme", "Change theme"),
            SlashCommand::new("help", "Show help"),
        ];
        let opts = [
            SlashOption::new("Dracula", "Purple"),
            SlashOption::new("Nord", "Blue"),
        ];

        // Simulate: user enters sub-menu, selected=0 (Back)
        let menu = SlashMenu::new(&cmds)
            .filter("")
            .selected(0)
            .visible(true)
            .max_visible(10)
            .show_options(&opts);

        let items = menu.items();
        assert_eq!(items.len(), 3, "items should be [Back, opt1, opt2]");
        assert!(matches!(items[0], MenuItem::Back), "first item must be Back");
        assert!(matches!(items[1], MenuItem::Option(_)), "second item is first option");
        assert!(matches!(items[2], MenuItem::Option(_)), "third item is second option");

        // Down arrow in example: slash_selected = (0 + 1) % 3 = 1
        let menu = SlashMenu::new(&cmds)
            .filter("")
            .selected(1)  // after pressing Down
            .visible(true)
            .max_visible(10)
            .show_options(&opts);

        let _items = menu.items();
        // The first option (Dracula) is at index 1, NOT Back (index 0)
        assert_eq!(menu.selected, 1, "selected should be 1 (first option)");
        assert_ne!(menu.selected, 0, "selected should NOT be 0 (Back)");
    }

    #[test]
    fn test_each_selection_position_in_submenu() {
        let cmds = [SlashCommand::new("theme", "Change theme")];
        let opts = [
            SlashOption::new("Dracula", "Purple"),
            SlashOption::new("Nord", "Blue"),
            SlashOption::new("Solarized", "Earth"),
        ];

        // selected=0 => Back must be selected
        let menu = SlashMenu::new(&cmds)
            .filter("").selected(0).visible(true).max_visible(10)
            .show_options(&opts);
        assert_eq!(menu.selected, 0);
        assert!(matches!(menu.items()[0], MenuItem::Back));

        // selected=1 => first option (Dracula) must be selected
        let menu = SlashMenu::new(&cmds)
            .filter("").selected(1).visible(true).max_visible(10)
            .show_options(&opts);
        assert_eq!(menu.selected, 1);

        // selected=2 => second option (Nord) must be selected
        let menu = SlashMenu::new(&cmds)
            .filter("").selected(2).visible(true).max_visible(10)
            .show_options(&opts);
        assert_eq!(menu.selected, 2);

        // selected=3 => third option (Solarized) must be selected
        let menu = SlashMenu::new(&cmds)
            .filter("").selected(3).visible(true).max_visible(10)
            .show_options(&opts);
        assert_eq!(menu.selected, 3);
    }

    #[test]
    fn test_filtered_commands() {
        let cmds = [
            SlashCommand::new("theme", "Change theme"),
            SlashCommand::new("help", "Show help"),
            SlashCommand::new("model", "Switch model"),
        ];

        let menu = SlashMenu::new(&cmds)
            .filter("th")
            .selected(0)
            .visible(true)
            .max_visible(10);

        let matched = menu.items();
        assert_eq!(matched.len(), 1, "only 'theme' matches 'th'");
        assert!(matches!(matched[0], MenuItem::Command(c) if c.name == "theme"));
    }
}
