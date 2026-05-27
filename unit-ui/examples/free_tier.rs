use std::time::{Duration, Instant};

use crossterm::event::{self, Event, KeyCode, KeyEventKind};
use ratatui::layout::{Constraint, Direction, Layout, Rect};
use ratatui::prelude::*;
use ratatui::style::Style;
use ratatui::text::{Line, Span, Text};
use ratatui::widgets::{Block, Borders, Paragraph};
use ratatui::Frame;

use unit_ui::prelude::*;
use unit_ui::theme::{providers::Provider, themes};
use unit_ui::widgets::{ConnectionStatus, SlashCommand, SlashOption};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    crossterm::terminal::enable_raw_mode()?;
    let mut stdout = std::io::stdout();
    crossterm::execute!(stdout, crossterm::terminal::EnterAlternateScreen)?;

    let mut terminal = Terminal::new(CrosstermBackend::new(stdout))?;

    let mut app = App::new();
    let res = app.run(&mut terminal);

    crossterm::terminal::disable_raw_mode()?;
    crossterm::execute!(
        terminal.backend_mut(),
        crossterm::terminal::LeaveAlternateScreen
    )?;

    if let Err(e) = res {
        eprintln!("Error: {e}");
    }

    Ok(())
}

const THEME_NAMES: &[&str] = &[
    "Dracula", "Nord", "Catppuccin Mocha", "Solarized Dark", "Gruvbox Dark",
    "Monokai", "Tokyo Night", "Ayu Dark", "One Dark", "Everforest Dark",
    "Kanagawa", "Rose Pine", "Material Ocean", "GitHub Dark", "Synthwave84",
    "Cyberpunk", "Night Owl", "Hack The Box", "Forest", "Marine",
];

const MODELS: &[SlashOption] = &[
    SlashOption::new("gpt-4o", "OpenAI GPT-4o"),
    SlashOption::new("claude-3-opus", "Anthropic Claude 3 Opus"),
    SlashOption::new("gemini-2.0", "Google Gemini 2.0"),
    SlashOption::new("llama-3", "Meta Llama 3"),
];

const TEMPERATURES: &[SlashOption] = &[
    SlashOption::new("0.1", "Precise, deterministic"),
    SlashOption::new("0.3", "Balanced, consistent"),
    SlashOption::new("0.5", "Moderate creativity"),
    SlashOption::new("0.7", "Creative (default)"),
    SlashOption::new("0.9", "Very creative"),
    SlashOption::new("1.0", "Maximum creativity"),
];

const THEME_OPTIONS: &[SlashOption] = &[
    SlashOption::new("Dracula", "Dark purple theme"),
    SlashOption::new("Nord", "Arctic blue theme"),
    SlashOption::new("Catppuccin Mocha", "Warm brown theme"),
    SlashOption::new("Solarized Dark", "Earthy dark theme"),
    SlashOption::new("Gruvbox Dark", "Retro dark theme"),
    SlashOption::new("Monokai", "Vibrant theme"),
    SlashOption::new("Tokyo Night", "Deep blue theme"),
    SlashOption::new("Ayu Dark", "Warm dark theme"),
    SlashOption::new("One Dark", "Atom editor theme"),
    SlashOption::new("Everforest Dark", "Green dark theme"),
    SlashOption::new("Kanagawa", "Japanese ink theme"),
    SlashOption::new("Rose Pine", "Soft pink theme"),
    SlashOption::new("Material Ocean", "Deep ocean theme"),
    SlashOption::new("GitHub Dark", "GitHub dark theme"),
    SlashOption::new("Synthwave84", "Retro synthwave"),
    SlashOption::new("Cyberpunk", "Neon cyber theme"),
    SlashOption::new("Night Owl", "Late night theme"),
    SlashOption::new("Hack The Box", "Green terminal theme"),
    SlashOption::new("Forest", "Nature green theme"),
    SlashOption::new("Marine", "Ocean blue theme"),
];

const DEMO_COMMANDS: &[SlashCommand] = &[
    SlashCommand::new("help", "Show available commands"),
    SlashCommand::new("model", "Switch AI model"),
    SlashCommand::new("theme", "Change UI theme"),
    SlashCommand::new("provider", "View provider info"),
    SlashCommand::new("clear", "Clear conversation"),
    SlashCommand::new("export", "Export conversation"),
    SlashCommand::new("search", "Search messages"),
    SlashCommand::new("summarize", "Summarize context"),
    SlashCommand::new("tokens", "Show token usage"),
    SlashCommand::new("temperature", "Set temperature"),
    SlashCommand::new("system", "Set system prompt"),
];

fn command_options(name: &str) -> Option<Vec<SlashOption>> {
    match name {
        "model" => Some(MODELS.to_vec()),
        "theme" => Some(THEME_OPTIONS.to_vec()),
        "temperature" => Some(TEMPERATURES.to_vec()),
        _ => None,
    }
}

struct App {
    theme_index: usize,
    model: String,
    temperature: String,
    scroll: usize,
    show_slash: bool,
    slash_filter: String,
    slash_selected: usize,
    in_submenu: bool,
    active_command: Option<&'static str>,
    active_options: Vec<SlashOption>,
    providers: Vec<Provider>,
    providers_visible: bool,
    status_message: String,
    status_timeout: Instant,
    started_at: Instant,
    _frame_count: u64,
}

impl App {
    fn new() -> Self {
        let mut providers: Vec<_> = Provider::all().to_vec();
        providers.sort_by_key(|p| p.name());
        Self {
            theme_index: 0,
            model: "gpt-4o".into(),
            temperature: "0.7".into(),
            scroll: 0,
            show_slash: false,
            slash_filter: String::new(),
            slash_selected: 0,
            in_submenu: false,
            active_command: None,
            active_options: vec![],
            providers,
            providers_visible: true,
            status_message: "[/] commands  ·  [q] quit".into(),
            status_timeout: Instant::now(),
            started_at: Instant::now(),
            _frame_count: 0,
        }
    }

    fn run(&mut self, terminal: &mut Terminal<CrosstermBackend<std::io::Stdout>>) -> Result<(), Box<dyn std::error::Error>> {
        loop {
            terminal.draw(|f| self.render(f))?;

            if event::poll(Duration::from_millis(80))? {
                if let Event::Key(key) = event::read()? {
                    if key.kind == KeyEventKind::Press {
                        self.handle_key(key.code);
                    }
                }
            }

            self._frame_count += 1;
        }
    }

    fn handle_key(&mut self, code: KeyCode) {
        match code {
            KeyCode::Char('q') if !self.show_slash => std::process::exit(0),
            KeyCode::Up if self.show_slash => {
                let count = self.menu_item_count();
                if count > 0 {
                    self.slash_selected = (self.slash_selected + count - 1) % count;
                }
            }
            KeyCode::Down if self.show_slash => {
                let count = self.menu_item_count();
                if count > 0 {
                    self.slash_selected = (self.slash_selected + 1) % count;
                }
            }
            KeyCode::Up => self.scroll = self.scroll.saturating_sub(1),
            KeyCode::Down => self.scroll += 1,
            KeyCode::Char('/') if !self.show_slash => {
                self.show_slash = true;
                self.in_submenu = false;
                self.active_command = None;
                self.active_options.clear();
                self.slash_filter = "/".to_string();
                self.slash_selected = 0;
                self.status_message.clear();
            }
            KeyCode::Esc if self.show_slash => {
                if self.in_submenu {
                    self.in_submenu = false;
                    self.active_command = None;
                    self.active_options.clear();
                    self.slash_filter.clear();
                    self.slash_selected = 0;
                } else {
                    self.show_slash = false;
                    self.slash_filter.clear();
                }
            }
            KeyCode::Enter if self.show_slash => {
                if self.in_submenu {
                    if self.slash_selected == 0 {
                        // Back selected
                        self.in_submenu = false;
                        self.active_command = None;
                        self.active_options.clear();
                        self.slash_filter.clear();
                        self.slash_selected = 0;
                    } else {
                        let idx = self.slash_selected - 1;
                        if let Some(opt) = self.active_options.get(idx) {
                            if let Some(cmd) = self.active_command {
                                self.run_command(cmd, Some(opt.name));
                            }
                        }
                        self.show_slash = false;
                        self.in_submenu = false;
                        self.active_command = None;
                        self.active_options.clear();
                        self.slash_filter.clear();
                    }
                } else {
                    let (cmd_name, has_opts) = {
                        let filtered = self.filtered_commands();
                        let name = filtered.get(self.slash_selected.min(filtered.len().saturating_sub(1))).copied().map(|c| c.name);
                        (name, name.and_then(command_options).map(|o| !o.is_empty()).unwrap_or(false))
                    };
                    if let Some(name) = cmd_name {
                        if has_opts {
                            let opts = command_options(name).unwrap();
                            self.in_submenu = true;
                            self.active_command = Some(name);
                            self.active_options = opts;
                            self.slash_filter.clear();
                            self.slash_selected = 0;
                        } else {
                            self.run_command(name, None);
                            self.show_slash = false;
                            self.slash_filter.clear();
                        }
                    }
                }
            }
            KeyCode::Char(c) if self.show_slash => {
                self.slash_filter.push(c);
                self.slash_selected = 0;
            }
            KeyCode::Backspace if self.show_slash => {
                if !self.slash_filter.is_empty() {
                    self.slash_filter.pop();
                }
                self.slash_selected = 0;
            }
            KeyCode::Char('t') if !self.show_slash => {
                self.theme_index = (self.theme_index + 1) % THEME_NAMES.len();
                self.status_message = format!("✓ Theme: {}", THEME_NAMES[self.theme_index]);
                self.status_timeout = Instant::now();
            }
            KeyCode::Char('p') if !self.show_slash => {
                self.providers_visible = !self.providers_visible;
                self.status_message = if self.providers_visible { "✓ Providers: visible" } else { "✓ Providers: hidden" }.into();
                self.status_timeout = Instant::now();
            }
            KeyCode::Char('c') if !self.show_slash => {
                self.scroll = 0;
                self.status_message = "✓ Scrolled to top".into();
                self.status_timeout = Instant::now();
            }
            _ => {}
        }
    }

    fn run_command(&mut self, name: &str, option: Option<&str>) {
        match name {
            "help" => self.status_message = "✓ Commands: /help, /model, /theme, /provider, /clear, /export, /search, /summarize, /tokens, /temperature, /system".into(),
            "model" => if let Some(m) = option { self.model = m.to_string(); self.status_message = format!("✓ Model: {}", m); }
            "theme" => if let Some(t) = option { if let Some(idx) = THEME_NAMES.iter().position(|n| n.eq_ignore_ascii_case(t)) { self.theme_index = idx; self.status_message = format!("✓ Theme: {}", t); } }
            "provider" => if let Some(p) = option { self.status_message = format!("✓ Provider: {}", p); }
            "clear" => self.status_message = "✓ Conversation cleared".into(),
            "export" => self.status_message = "✓ Exported to conversation.md".into(),
            "search" => self.status_message = "✓ Search mode (free tier: basic)".into(),
            "summarize" => self.status_message = "✓ Summary: 0 messages, 0 tokens".into(),
            "tokens" => self.status_message = "✓ Tokens: 1,423 used".into(),
            "temperature" => if let Some(t) = option { self.temperature = t.to_string(); self.status_message = format!("✓ Temperature: {}", t); }
            "system" => self.status_message = "✓ System prompt set".into(),
            _ => {}
        }
        self.status_timeout = Instant::now();
    }

    fn filtered_commands(&self) -> Vec<&SlashCommand> {
        let f = self.slash_filter.trim_start_matches('/').to_lowercase();
        if f.is_empty() {
            return DEMO_COMMANDS.iter().collect();
        }
        DEMO_COMMANDS.iter().filter(|c| c.name.contains(&f)).collect()
    }

    fn menu_item_count(&self) -> usize {
        if self.in_submenu {
            1 + self.active_options.len()
        } else {
            self.filtered_commands().len()
        }
    }

    fn current_theme(&self) -> StyleToken {
        let name = THEME_NAMES[self.theme_index];
        themes::from_name(name).map(|t| t.palette).unwrap_or_default()
    }

    fn render(&mut self, frame: &mut Frame) {
        let style = self.current_theme();
        let area = frame.area();

        let chunks = Layout::default()
            .direction(Direction::Vertical)
            .constraints([
                Constraint::Length(5),
                Constraint::Min(1),
                Constraint::Length(1),
                Constraint::Length(3),
            ])
            .split(area);

        self.render_header(chunks[0], frame, &style);
        if self.providers_visible {
            self.render_provider_list(chunks[1], frame, &style);
        }
        self.render_status_bar(chunks[2], frame, &style);
        self.render_footer(chunks[3], frame, &style);

        if self.show_slash {
            self.render_slash_menu(frame, &style);
        }
    }

    fn render_header(&self, area: Rect, frame: &mut Frame, style: &StyleToken) {
        let accent = Style::default().fg(style.accent);
        let dimmed = Style::default().fg(style.text_dim);
        let text = Style::default().fg(style.text);

        let block = Block::default()
            .borders(Borders::ALL)
            .border_style(accent)
            .title(Span::styled(" unit-ui FREE TIER ", accent));

        let inner = block.inner(area);

        let lines = vec![
            Line::from(vec![
                Span::styled(" Theme: ", dimmed),
                Span::styled(THEME_NAMES[self.theme_index], accent),
                Span::styled("  │  Model: ", dimmed),
                Span::styled(&self.model, text),
                Span::styled("  │  Temp: ", dimmed),
                Span::styled(&self.temperature, text),
            ]),
            Line::from(vec![
                Span::styled(format!(" ✦ {} providers", Provider::all().len()), text),
                Span::styled(format!("  ✦ {} themes", THEME_NAMES.len()), text),
                Span::styled(format!("  ✦ {} commands", DEMO_COMMANDS.len()), dimmed),
            ]),
        ];

        block.render(area, frame.buffer_mut());
        let text_area = Rect {
            x: inner.x + 1,
            y: inner.y + 1,
            width: inner.width.saturating_sub(2),
            height: 2,
        };
        Paragraph::new(Text::from(lines)).render(text_area, frame.buffer_mut());
    }

    fn render_provider_list(&self, area: Rect, frame: &mut Frame, style: &StyleToken) {
        let text_dim = Style::default().fg(style.text_dim);
        let accent = Style::default().fg(style.accent);
        let text = Style::default().fg(style.text);

        let block = Block::default()
            .borders(Borders::ALL)
            .border_style(accent)
            .title(Span::styled(" Provider Gallery ", text_dim));

        let inner = block.inner(area);

        let mut lines: Vec<Line> = Vec::new();
        for (idx, provider) in self.providers.iter().enumerate().skip(self.scroll) {
            if lines.len() >= inner.height as usize {
                break;
            }
            let color = provider.color();
            let pad = " ".repeat((20usize).saturating_sub(provider.name().len()));
            lines.push(Line::from(vec![
                Span::styled(format!("{:3}  ", idx + 1), text_dim),
                Span::styled("██", Style::default().fg(color)),
                Span::styled("  ", text_dim),
                Span::styled(format!("{}{}", provider.name(), pad), text),
            ]));
        }

        block.render(area, frame.buffer_mut());
        Paragraph::new(Text::from(lines)).render(inner, frame.buffer_mut());
    }

    fn render_status_bar(&self, area: Rect, frame: &mut Frame, style: &StyleToken) {
        let status_bar = StatusBar::new()
            .provider("openai")
            .model(&self.model)
            .connection(ConnectionStatus::Connected)
            .started_at(self.started_at)
            .token_count(1423)
            .style(style.clone());

        frame.render_widget(&status_bar, area);
    }

    fn render_footer(&self, area: Rect, frame: &mut Frame, style: &StyleToken) {
        let accent = Style::default().fg(style.accent);
        let dimmed = Style::default().fg(style.text_dim);

        let block = Block::default()
            .borders(Borders::ALL)
            .border_style(accent);

        let inner = block.inner(area);

        let elapsed = self.status_timeout.elapsed();
        let message = if elapsed < Duration::from_secs(3) && !self.status_message.is_empty() {
            self.status_message.as_str()
        } else if self.show_slash {
            ""
        } else {
            "[/] commands  ·  [t] theme  ·  [p] providers  ·  [c] scroll top  ·  [q] quit"
        };

        block.render(area, frame.buffer_mut());
        Paragraph::new(Text::from(Line::from(Span::styled(message, if self.show_slash { accent } else { dimmed }))))
            .render(inner, frame.buffer_mut());
    }

    fn render_slash_menu(&self, frame: &mut Frame, style: &StyleToken) {
        let area = frame.area();
        let popup_width = area.width.min(60);
        let popup_height = area.height.saturating_sub(8).clamp(5, 25);

        let y = 5;
        let popup_area = Rect { x: 0, y, width: popup_width, height: popup_height };

        let mut menu = SlashMenu::new(DEMO_COMMANDS)
            .filter(&self.slash_filter)
            .selected(self.slash_selected)
            .visible(true)
            .max_visible(popup_height.saturating_sub(2) as usize)
            .label("Commands")
            .style(style.clone());

        if self.in_submenu {
            menu = menu.show_options(&self.active_options);
        }

        frame.render_widget(&menu, popup_area);
    }
}
