use std::time::{Duration, Instant};

use crossterm::event::{self, Event, KeyCode, KeyEventKind};
use ratatui::layout::{Constraint, Direction, Layout, Rect};
use ratatui::prelude::*;
use ratatui::style::Style;
use ratatui::text::{Line, Span, Text};
use ratatui::widgets::{Block, Borders, Paragraph};
use ratatui::Frame;

use unit_ui::prelude::*;
use unit_ui::theme::themes;
use unit_ui::widgets::{ConnectionStatus, SlashCommand, SlashOption, SlashMenu, MessageBubble, BasicInput, StreamingText, StatusBar};

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
    SlashCommand::new("temperature", "Set temperature"),
    SlashCommand::new("clear", "Clear conversation"),
    SlashCommand::new("export", "Export conversation"),
    SlashCommand::new("tokens", "Show token usage"),
    SlashCommand::new("system", "Set system prompt"),
    SlashCommand::new("provider", "Show provider info"),
];

fn command_options(name: &str) -> Option<Vec<SlashOption>> {
    match name {
        "model" => Some(MODELS.to_vec()),
        "theme" => Some(THEME_OPTIONS.to_vec()),
        "temperature" => Some(TEMPERATURES.to_vec()),
        _ => None,
    }
}

struct ChatMessage {
    role: Role,
    content: String,
}

struct App {
    messages: Vec<ChatMessage>,
    input: String,
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
    status_message: String,
    status_timeout: Instant,
    started_at: Instant,
    streaming: bool,
    streaming_buffer: String,
    streaming_pos: usize,
    streaming_response: String,
    frame_count: u64,
}

impl App {
    fn new() -> Self {
        let messages = vec![
            ChatMessage { role: Role::System, content: "Welcome to unit-ui CLI! Type a message or press / for commands.".into() },
            ChatMessage { role: Role::Assistant, content: "Hi! I'm your AI assistant. Try typing something, or use /help to see what I can do.".into() },
        ];

        Self {
            messages,
            input: String::new(),
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
            status_message: String::new(),
            status_timeout: Instant::now(),
            started_at: Instant::now(),
            streaming: false,
            streaming_buffer: String::new(),
            streaming_pos: 0,
            streaming_response: String::new(),
            frame_count: 0,
        }
    }

    fn run(&mut self, terminal: &mut Terminal<CrosstermBackend<std::io::Stdout>>) -> Result<(), Box<dyn std::error::Error>> {
        loop {
            terminal.draw(|f| self.render(f))?;

            self.tick();

            if event::poll(Duration::from_millis(30))? {
                if let Event::Key(key) = event::read()? {
                    if key.kind == KeyEventKind::Press {
                        self.handle_key(key.code);
                    }
                }
            }

            self.frame_count += 1;
        }
    }

    fn tick(&mut self) {
        if self.streaming {
            if self.streaming_pos < self.streaming_response.len() {
                let chunk = &self.streaming_response[self.streaming_pos..];
                let take = 3.min(chunk.len());
                self.streaming_buffer.push_str(&chunk[..take]);
                self.streaming_pos += take;
            } else {
                self.streaming = false;
                self.messages.push(ChatMessage {
                    role: Role::Assistant,
                    content: self.streaming_buffer.clone(),
                });
                self.streaming_buffer.clear();
                self.streaming_response.clear();
                self.streaming_pos = 0;
            }
        }
    }

    fn handle_key(&mut self, code: KeyCode) {
        match code {
            KeyCode::Char('q') if !self.show_slash && !self.streaming => std::process::exit(0),
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
            KeyCode::Up if !self.streaming => {
                self.scroll = self.scroll.saturating_sub(1);
            }
            KeyCode::Down if !self.streaming => {
                self.scroll += 1;
            }
            KeyCode::Char('/') if !self.show_slash && !self.streaming => {
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
            KeyCode::Enter if !self.streaming => {
                if self.show_slash {
                    self.handle_slash_enter();
                } else if !self.input.is_empty() {
                    self.send_message();
                }
            }
            KeyCode::Char(c) if !self.streaming && !self.show_slash => {
                self.input.push(c);
            }
            KeyCode::Char(c) if self.show_slash => {
                self.slash_filter.push(c);
                self.slash_selected = 0;
            }
            KeyCode::Backspace if !self.streaming && !self.show_slash => {
                self.input.pop();
            }
            KeyCode::Backspace if self.show_slash => {
                if !self.slash_filter.is_empty() {
                    self.slash_filter.pop();
                }
                self.slash_selected = 0;
            }
            _ => {}
        }
    }

    fn handle_slash_enter(&mut self) {
        if self.in_submenu {
            if self.slash_selected == 0 {
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

    fn send_message(&mut self) {
        let text = self.input.clone();
        self.messages.push(ChatMessage { role: Role::User, content: text });
        self.input.clear();
        self.scroll = 0;

        let response = generate_response(&self.model, &self.temperature);
        self.streaming = true;
        self.streaming_buffer = String::new();
        self.streaming_pos = 0;
        self.streaming_response = response;
    }

    fn run_command(&mut self, name: &str, option: Option<&str>) {
        match name {
            "help" => self.status_message = "Commands: /model, /theme, /temperature, /clear, /export, /tokens, /system, /provider".into(),
            "model" => if let Some(m) = option { self.model = m.to_string(); self.status_message = format!("Model: {}", m); }
            "theme" => if let Some(t) = option { if let Some(idx) = THEME_NAMES.iter().position(|n| n.eq_ignore_ascii_case(t)) { self.theme_index = idx; self.status_message = format!("Theme: {}", t); } }
            "temperature" => if let Some(t) = option { self.temperature = t.to_string(); self.status_message = format!("Temperature: {}", t); }
            "clear" => { self.messages.clear(); self.status_message = "Conversation cleared".into(); }
            "export" => self.status_message = "Exported to conversation.md".into(),
            "tokens" => self.status_message = "Tokens: ~1.4k used".into(),
            "system" => self.status_message = "System prompt set".into(),
            "provider" => self.status_message = "Provider info: 80 providers available".into(),
            _ => {}
        }
        self.status_timeout = Instant::now();
    }

    fn filtered_commands(&self) -> Vec<&SlashCommand> {
        let f = self.slash_filter.trim_start_matches('/').to_lowercase();
        if f.is_empty() { return DEMO_COMMANDS.iter().collect(); }
        DEMO_COMMANDS.iter().filter(|c| c.name.contains(&f)).collect()
    }

    fn menu_item_count(&self) -> usize {
        if self.in_submenu { 1 + self.active_options.len() } else { self.filtered_commands().len() }
    }

    fn current_theme(&self) -> StyleToken {
        let name = THEME_NAMES[self.theme_index];
        themes::from_name(name).map(|t| t.palette).unwrap_or_default()
    }

    fn render(&mut self, frame: &mut Frame) {
        let style = self.current_theme();
        let area = frame.area();
        let min_height = 12u16;
        if area.height < min_height { return; }

        let constraints = vec![
            Constraint::Length(1),
            Constraint::Min(1),
            Constraint::Length(1),
            Constraint::Length(3),
        ];

        let chunks = Layout::default()
            .direction(Direction::Vertical)
            .constraints(constraints)
            .split(area);

        self.render_header(chunks[0], frame, &style);
        self.render_messages(chunks[1], frame, &style);
        self.render_input(chunks[2], frame, &style);
        self.render_footer(chunks[3], frame, &style);

        if self.show_slash {
            self.render_slash_menu(frame, &style);
        }
    }

    fn render_header(&self, area: Rect, frame: &mut Frame, style: &StyleToken) {
        let status_bar = StatusBar::new()
            .provider("openai")
            .model(&self.model)
            .connection(if self.streaming { ConnectionStatus::Connecting } else { ConnectionStatus::Connected })
            .started_at(self.started_at)
            .token_count(1423)
            .style(style.clone());

        frame.render_widget(&status_bar, area);
    }

    fn render_messages(&self, area: Rect, frame: &mut Frame, style: &StyleToken) {
        let accent = Style::default().fg(style.accent);
        let text_dim = Style::default().fg(style.text_dim);

        let block = Block::default()
            .borders(Borders::ALL)
            .border_style(accent)
            .title(Span::styled(" Messages ", text_dim));

        let inner = block.inner(area);

        let mut y = inner.top();

        let scroll = self.scroll.min(
            self.messages.len().saturating_sub(inner.height as usize)
        );

        for msg in self.messages.iter().skip(scroll) {
            if y + 3 > inner.bottom() { break; }

            let bubble = MessageBubble::new(&msg.content, msg.role)
                .style(style.clone());

            let h = msg.content.len().max(20) / inner.width as usize + 2;
            let h = (h as u16).min(inner.bottom().saturating_sub(y));
            let bubble_area = Rect {
                x: inner.x + 1,
                y,
                width: inner.width.saturating_sub(2),
                height: h,
            };
            frame.render_widget(&bubble, bubble_area);
            y += h;
        }

        if self.streaming {
            let streaming = StreamingText::new(&self.streaming_buffer)
                .style(style.clone());
            if y + 3 <= inner.bottom() {
                let st_area = Rect { x: inner.x + 1, y: y + 1, width: inner.width.saturating_sub(2), height: inner.bottom().saturating_sub(y + 1) };
                frame.render_widget(&streaming, st_area);
            }
        }

        block.render(area, frame.buffer_mut());
    }

    fn render_input(&self, area: Rect, frame: &mut Frame, style: &StyleToken) {
        if self.streaming { return; }

        let input = BasicInput::new(&self.input)
            .placeholder("Type a message...")
            .focused(true)
            .style(style.clone());

        frame.render_widget(&input, area);
    }

    fn render_footer(&self, area: Rect, frame: &mut Frame, style: &StyleToken) {
        let accent = Style::default().fg(style.accent);
        let dimmed = Style::default().fg(style.text_dim);
        let text_color = Style::default().fg(style.text);

        let block = Block::default()
            .borders(Borders::ALL)
            .border_style(accent);

        let inner = block.inner(area);

        let elapsed = self.status_timeout.elapsed();
        let show_msg = elapsed < Duration::from_secs(3) && !self.status_message.is_empty();

        let line = if show_msg {
            Line::from(Span::styled(&self.status_message, text_color))
        } else if self.streaming {
            Line::from(Span::styled("Streaming response...  [q] quit", dimmed))
        } else {
                    Line::from(vec![
                        Span::styled("[/] commands", dimmed),
                        Span::styled("  ·  ", dimmed),
                        Span::styled("[t] theme", dimmed),
                        Span::styled("  ·  ", dimmed),
                        Span::styled("[↑↓] scroll", dimmed),
                        Span::styled("  ·  ", dimmed),
                        Span::styled("[q] quit", dimmed),
                    ])
        };

        block.render(area, frame.buffer_mut());
        Paragraph::new(Text::from(line)).render(inner, frame.buffer_mut());
    }

    fn render_slash_menu(&self, frame: &mut Frame, style: &StyleToken) {
        let area = frame.area();
        let input_top = area.height.saturating_sub(4);
        let popup_width = area.width.min(60);
        let popup_height = input_top.saturating_sub(1).clamp(5, 25);

        let y = input_top.saturating_sub(popup_height);
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

fn generate_response(model: &str, temperature: &str) -> String {
    let responses = [
        "That's a great question! Here's what I know about it. The key insight is that modern AI systems are built on transformer architectures that process tokens in parallel, allowing for much faster training and inference than previous recurrent models.",
        "I understand what you're asking. Let me break this down:\n\n1. First, we need to consider the architecture\n2. Then look at the training data\n3. Finally evaluate the results\n\nThis approach has proven effective in production systems.",
        "Sure! Here's a code example:\n\n```rust\nfn hello() -> &'static str {\n    \"Hello, world!\"\n}\n```\n\nThis simple function returns a greeting string. You can call it anywhere in your code.",
        "The answer depends on several factors. In general, the optimal approach varies based on:\n- The size of your dataset\n- The computational resources available\n- Your specific use case and latency requirements\n\nWould you like me to elaborate on any of these?",
        "Interesting perspective! Let me add to that. The field is evolving rapidly, with new breakthroughs happening regularly. Some key trends include:\n- Improved reasoning capabilities\n- Better tool use and function calling\n- More efficient model architectures\n- Enhanced safety and alignment techniques",
        "I've analyzed your request and here's my recommendation. Based on the current best practices in the industry, I suggest taking a modular approach that separates concerns and allows for easy iteration. This way you can adapt to changing requirements without major rewrites.",
    ];

    let idx = model.len() + temperature.len() + responses.len();
    responses[idx % responses.len()].to_string()
}
