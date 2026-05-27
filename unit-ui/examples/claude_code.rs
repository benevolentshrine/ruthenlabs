use std::time::{Duration, Instant};

use crossterm::event::{self, Event, KeyCode, KeyEventKind};
use ratatui::backend::CrosstermBackend;
use ratatui::layout::{Constraint, Layout, Rect};
use ratatui::style::{Color, Style};
use ratatui::text::{Line, Span, Text};
use ratatui::widgets::{Block, Borders, Paragraph, Widget};
use ratatui::Frame;

use unit_ui::prelude::*;
use unit_ui::theme::themes;
use unit_ui::widgets::{
    BasicInput, ConnectionStatus, MessageBubble, Role, SlashCommand, SlashMenu, SlashOption,
    Spinner, StatusBar, StreamingText,
};

// Claude Code authentic palette
const CLAUDE_BG: Color = Color::Rgb(26, 26, 46);
const CLAUDE_ORANGE: Color = Color::Rgb(217, 119, 87);
const CLAUDE_DIM: Color = Color::Rgb(100, 100, 130);
const CLAUDE_TEXT: Color = Color::Rgb(220, 220, 240);
const CLAUDE_GREEN: Color = Color::Rgb(80, 200, 120);

fn claude_style() -> StyleToken {
    StyleToken::builder()
        .accent(CLAUDE_ORANGE)
        .text(CLAUDE_TEXT)
        .text_dim(CLAUDE_DIM)
        .success(CLAUDE_GREEN)
        .surface(CLAUDE_BG)
        .thinking(Color::Rgb(251, 188, 4))
        .build()
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    crossterm::terminal::enable_raw_mode()?;
    let mut stdout = std::io::stdout();
    crossterm::execute!(stdout, crossterm::terminal::EnterAlternateScreen)?;

    let mut terminal = ratatui::Terminal::new(CrosstermBackend::new(stdout))?;

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
    "Claude Code", "Dracula", "Nord", "Catppuccin Mocha", "Solarized Dark",
    "Gruvbox Dark", "Monokai", "Tokyo Night", "Ayu Dark", "One Dark",
];

const MODELS: &[SlashOption] = &[
    SlashOption::new("claude-sonnet-4", "Anthropic Claude Sonnet 4"),
    SlashOption::new("claude-opus-4", "Anthropic Claude Opus 4"),
    SlashOption::new("claude-haiku-4-5", "Anthropic Claude Haiku 4.5"),
    SlashOption::new("gpt-4o", "OpenAI GPT-4o"),
    SlashOption::new("gemini-2.5-pro", "Google Gemini 2.5 Pro"),
];

const TEMPERATURES: &[SlashOption] = &[
    SlashOption::new("0.1", "Precise, deterministic"),
    SlashOption::new("0.3", "Balanced, consistent"),
    SlashOption::new("0.5", "Moderate creativity"),
    SlashOption::new("0.7", "Creative"),
    SlashOption::new("0.9", "Very creative"),
];

const THEME_OPTIONS: &[SlashOption] = &[
    SlashOption::new("Default", "Claude Code authentic"),
    SlashOption::new("Dracula", "Dark purple theme"),
    SlashOption::new("Nord", "Arctic blue theme"),
    SlashOption::new("Catppuccin Mocha", "Warm brown theme"),
    SlashOption::new("Solarized Dark", "Earthy dark theme"),
    SlashOption::new("Gruvbox Dark", "Retro dark theme"),
    SlashOption::new("Monokai", "Vibrant theme"),
    SlashOption::new("Tokyo Night", "Deep blue theme"),
    SlashOption::new("One Dark", "Atom editor theme"),
];

const DEMO_COMMANDS: &[SlashCommand] = &[
    SlashCommand::new("help", "Show available commands"),
    SlashCommand::new("model", "Switch AI model"),
    SlashCommand::new("theme", "Change UI theme"),
    SlashCommand::new("temperature", "Set temperature"),
    SlashCommand::new("clear", "Clear conversation"),
    SlashCommand::new("compact", "Compact conversation history"),
    SlashCommand::new("status", "Show session status"),
    SlashCommand::new("exit", "Exit Claude Code"),
];

fn command_options(name: &str) -> Option<&'static [SlashOption]> {
    match name {
        "model" => Some(MODELS),
        "theme" => Some(THEME_OPTIONS),
        "temperature" => Some(TEMPERATURES),
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
    use_claude_default: bool,
    palette_index: usize,
    model: &'static str,
    temperature: &'static str,
    scroll: usize,
    auto_scroll: bool,
    show_slash: bool,
    slash_filter: String,
    slash_selected: usize,
    in_submenu: bool,
    active_command: Option<&'static str>,
    active_options: Vec<SlashOption>,
    status_message: String,
    status_timeout: Instant,
    started_at: Instant,
    phase: Phase,
    streaming_buffer: String,
    streaming_pos: usize,
    streaming_response: String,
    thinking_frames: usize,
    frame_count: u64,
}

enum Phase {
    Idle,
    Thinking,
    Streaming,
}

impl App {
    fn new() -> Self {
        let messages = vec![
            ChatMessage {
                role: Role::System,
                content: "Connected to Claude Code. Press / for commands.".into(),
            },
            ChatMessage {
                role: Role::Assistant,
                content: "Hi! I'm Claude. I can help you code, debug, and answer questions. Try typing a message or press / to see available commands.".into(),
            },
        ];

        Self {
            messages,
            input: String::new(),
            use_claude_default: true,
            palette_index: 0,
            model: "claude-sonnet-4",
            temperature: "0.7",
            scroll: 0,
            auto_scroll: true,
            show_slash: false,
            slash_filter: String::new(),
            slash_selected: 0,
            in_submenu: false,
            active_command: None,
            active_options: vec![],
            status_message: String::new(),
            status_timeout: Instant::now(),
            started_at: Instant::now(),
            phase: Phase::Idle,
            streaming_buffer: String::new(),
            streaming_pos: 0,
            streaming_response: String::new(),
            thinking_frames: 0,
            frame_count: 0,
        }
    }

    fn run(
        &mut self,
        terminal: &mut ratatui::Terminal<CrosstermBackend<std::io::Stdout>>,
    ) -> Result<(), Box<dyn std::error::Error>> {
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
        match self.phase {
            Phase::Thinking => {
                self.thinking_frames += 1;
                if self.thinking_frames > 10 {
                    self.phase = Phase::Streaming;
                    self.streaming_pos = 0;
                    self.streaming_buffer = String::new();
                }
            }
            Phase::Streaming => {
                if self.streaming_pos < self.streaming_response.len() {
                    let chunk = &self.streaming_response[self.streaming_pos..];
                    let take = 4.min(chunk.len());
                    self.streaming_buffer.push_str(&chunk[..take]);
                    self.streaming_pos += take;
                } else {
                    self.messages.push(ChatMessage {
                        role: Role::Assistant,
                        content: self.streaming_buffer.clone(),
                    });
                    self.streaming_buffer.clear();
                    self.streaming_response.clear();
                    self.phase = Phase::Idle;
                    self.auto_scroll = true;
                }
            }
            Phase::Idle => {}
        }
    }

    fn handle_key(&mut self, code: KeyCode) {
        // Slash menu mode takes full priority
        if self.show_slash {
            match code {
                KeyCode::Up => {
                    let count = self.menu_item_count();
                    if count > 0 {
                        self.slash_selected = (self.slash_selected + count - 1) % count;
                    }
                }
                KeyCode::Down => {
                    let count = self.menu_item_count();
                    if count > 0 {
                        self.slash_selected = (self.slash_selected + 1) % count;
                    }
                }
                KeyCode::Esc => {
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
                KeyCode::Enter => {
                    self.handle_slash_enter();
                }
                KeyCode::Char(c) => {
                    self.slash_filter.push(c);
                    self.slash_selected = 0;
                }
                KeyCode::Backspace => {
                    if !self.slash_filter.is_empty() {
                        self.slash_filter.pop();
                    }
                    self.slash_selected = 0;
                }
                _ => {}
            }
            return;
        }

        // Normal mode
        match code {
            KeyCode::Up => {
                self.auto_scroll = false;
                self.scroll = self.scroll.saturating_sub(1);
            }
            KeyCode::Down => {
                self.auto_scroll = false;
                self.scroll = self.scroll.saturating_add(1);
            }
            KeyCode::Char('/') => {
                self.show_slash = true;
                self.in_submenu = false;
                self.active_command = None;
                self.active_options.clear();
                self.slash_filter = "/".to_string();
                self.slash_selected = 0;
                self.status_message.clear();
            }
            KeyCode::Esc => {}
            KeyCode::Enter if !self.input.is_empty() => {
                self.send_message();
            }
            KeyCode::Char(c) => {
                self.input.push(c);
            }
            KeyCode::Backspace => {
                self.input.pop();
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
                let name = filtered
                    .get(self.slash_selected.min(filtered.len().saturating_sub(1)))
                    .copied()
                    .map(|c| c.name);
                (
                    name,
                    name.and_then(command_options)
                        .map(|o| !o.is_empty())
                        .unwrap_or(false),
                )
            };
            if let Some(name) = cmd_name {
                if name == "exit" {
                    std::process::exit(0);
                } else if has_opts {
                    let opts = command_options(name).unwrap();
                    self.in_submenu = true;
                    self.active_command = Some(name);
                    self.active_options = opts.to_vec();
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
        self.messages
            .push(ChatMessage { role: Role::User, content: text });
        self.input.clear();
        self.auto_scroll = true;

        let response = generate_response(self.model, self.temperature);
        self.streaming_response = response;
        self.phase = Phase::Thinking;
        self.thinking_frames = 0;
    }

    fn run_command(&mut self, name: &str, option: Option<&str>) {
        let msg = match (name, option) {
            ("help", _) => "Available: /model, /theme, /temperature, /clear, /compact, /status, /exit".into(),
            ("model", Some(m)) => {
                let val = MODELS.iter().find(|o| o.name == m).map(|o| o.name).unwrap_or(self.model);
                self.model = val;
                format!("Model: {}", val)
            }
            ("theme", Some(t)) => {
                if t.eq_ignore_ascii_case("Default") || t.eq_ignore_ascii_case("Claude Code") {
                    self.use_claude_default = true;
                    "Theme: Claude Code".into()
                } else if let Some(idx) = THEME_NAMES.iter().skip(1).position(|n| n.eq_ignore_ascii_case(t)) {
                    self.use_claude_default = false;
                    self.palette_index = idx;
                    format!("Theme: {}", t)
                } else {
                    "Unknown theme".into()
                }
            }
            ("temperature", Some(t)) => {
                let val = TEMPERATURES.iter().find(|o| o.name == t).map(|o| o.name).unwrap_or(self.temperature);
                self.temperature = val;
                format!("Temperature: {}", val)
            }
            ("clear", _) => { self.messages.retain(|m| m.role == Role::System); "Conversation cleared".into() }
            ("compact", _) => "Context compacted — 1.2k tokens freed".into(),
            ("status", _) => format!("Model: {} | Temperature: {} | Theme: {}", self.model, self.temperature, if self.use_claude_default { "Claude Code" } else { THEME_NAMES.get(self.palette_index + 1).unwrap_or(&"unknown") }),
            ("exit", _) => std::process::exit(0),
            _ => format!("Executed: /{} {:?}", name, option.unwrap_or("")),
        };
        self.status_message = msg;
        self.status_timeout = Instant::now();
    }

    fn filtered_commands(&self) -> Vec<&SlashCommand> {
        let f = self.slash_filter.trim_start_matches('/').to_lowercase();
        if f.is_empty() {
            return DEMO_COMMANDS.iter().collect();
        }
        DEMO_COMMANDS
            .iter()
            .filter(|c| c.name.contains(&f))
            .collect()
    }

    fn menu_item_count(&self) -> usize {
        if self.in_submenu {
            1 + self.active_options.len()
        } else {
            self.filtered_commands().len()
        }
    }

    fn current_style(&self) -> StyleToken {
        if self.use_claude_default {
            claude_style()
        } else {
            let name = THEME_NAMES
                .get(self.palette_index + 1)
                .copied()
                .unwrap_or("Dracula");
            themes::from_name(name)
                .map(|t| t.palette)
                .unwrap_or_else(claude_style)
        }
    }
}

// ── Rendering ──

impl App {
    fn render(&mut self, frame: &mut Frame) {
        let style = self.current_style();
        let area = frame.area();
        if area.height < 14 {
            return;
        }

        let bg = Style::default().bg(style.surface);
        let clear = Paragraph::new("").style(bg);
        frame.render_widget(clear, area);

        let [top_line, messages_area, footer_area, input_area] =
            Layout::vertical([
                Constraint::Length(1),
                Constraint::Min(1),
                Constraint::Length(1),
                Constraint::Length(1),
            ])
            .areas(area);

        self.render_header(top_line, frame, &style);
        self.render_messages(messages_area, frame, &style);
        self.render_footer(footer_area, frame, &style);
        self.render_input(input_area, frame, &style);

        if self.show_slash {
            self.render_slash_menu(frame, &style);
        }
    }

    fn render_header(&self, area: Rect, frame: &mut Frame, style: &StyleToken) {
        let conn = match self.phase {
            Phase::Idle => ConnectionStatus::Connected,
            Phase::Thinking | Phase::Streaming => ConnectionStatus::Connecting,
        };
        let status = StatusBar::new()
            .provider("Anthropic")
            .model(self.model)
            .connection(conn)
            .started_at(self.started_at)
            .style(style.clone());
        frame.render_widget(&status, area);
    }

    fn render_messages(&self, area: Rect, frame: &mut Frame, style: &StyleToken) {
        let border = Style::default().fg(style.text_dim);
        let block = Block::default()
            .borders(Borders::ALL)
            .border_style(border);
        let inner = block.inner(area);

        let max_scroll = if inner.height < 4 {
            0
        } else {
            let mut h: u16 = 0;
            let mut count = 0usize;
            for msg in self.messages.iter().rev() {
                let lc = approx_line_count(&msg.content, inner.width.saturating_sub(4) as usize) as u16;
                let msg_h = 1 + lc + 2; // label(1) + content(lc) + bubble_padding(1) + gap(1)
                if h + msg_h > inner.height - 1 {
                    break;
                }
                h += msg_h;
                count += 1;
            }
            self.messages.len().saturating_sub(count)
        };

        let scroll = if self.auto_scroll {
            max_scroll
        } else {
            self.scroll.min(max_scroll)
        };

        let mut y = inner.top();

        for msg in self.messages.iter().skip(scroll) {
            if y + 2 > inner.bottom() {
                break;
            }

            let label = match msg.role {
                Role::User => "You",
                Role::Assistant => "Claude",
                Role::System => "System",
            };
            let label_color = match msg.role {
                Role::User => style.accent,
                Role::Assistant => style.success,
                Role::System => style.text_dim,
            };

            let label_span = Span::styled(format!(" {}", label), Style::default().fg(label_color));
            frame.render_widget(&label_span, Rect {
                x: inner.x + 1,
                y,
                width: inner.width.saturating_sub(2).min(20),
                height: 1,
            });
            y += 1;
            if y >= inner.bottom() {
                break;
            }

            let line_count = approx_line_count(&msg.content, inner.width.saturating_sub(4) as usize);
            let h = (line_count as u16 + 1).min(inner.bottom().saturating_sub(y).max(1));
            let bubble_area = Rect {
                x: inner.x + 1,
                y,
                width: inner.width.saturating_sub(2),
                height: h,
            };
            let bubble = MessageBubble::new(&msg.content, msg.role).style(style.clone());
            frame.render_widget(&bubble, bubble_area);
            y += h + 1;
        }

        match self.phase {
            Phase::Thinking => {
                if y + 1 < inner.bottom() {
                    let spinner = Spinner::new()
                        .frame_index(self.frame_count as usize)
                        .label("Claude is thinking...")
                        .style(style.clone());
                    frame.render_widget(
                        &spinner,
                        Rect {
                            x: inner.x + 1,
                            y,
                            width: 30,
                            height: 1,
                        },
                    );
                }
            }
            Phase::Streaming => {
                if y + 2 < inner.bottom() {
                    let claude_label = Span::styled(" Claude", Style::default().fg(style.success));
                    frame.render_widget(&claude_label, Rect {
                        x: inner.x + 1,
                        y,
                        width: 20,
                        height: 1,
                    });
                    y += 1;
                    let stream = StreamingText::new(&self.streaming_buffer)
                        .style(style.clone());
                    let stream_area = Rect {
                        x: inner.x + 1,
                        y,
                        width: inner.width.saturating_sub(2),
                        height: inner.bottom().saturating_sub(y),
                    };
                    frame.render_widget(&stream, stream_area);
                }
            }
            Phase::Idle => {}
        }

        block.render(area, frame.buffer_mut());
    }

    fn render_input(&self, area: Rect, frame: &mut Frame, style: &StyleToken) {
        let input = BasicInput::new(&self.input)
            .placeholder("Ask anything...")
            .focused(true)
            .style(style.clone());
        frame.render_widget(&input, area);
    }

    fn render_footer(&self, area: Rect, frame: &mut Frame, style: &StyleToken) {
        let dim = Style::default().fg(style.text_dim);

        let elapsed = self.status_timeout.elapsed();
        let show_msg = elapsed < Duration::from_secs(3) && !self.status_message.is_empty();

        let line = if show_msg {
            Line::from(Span::styled(&self.status_message, Style::default().fg(style.text)))
        } else {
            match self.phase {
                Phase::Streaming => {
                    Line::from(vec![
                        Span::styled(" Claude is typing...", dim),
                    ])
                }
                _ => Line::from(vec![
                    Span::styled("[/] commands", dim),
                    Span::styled("  ·  ", dim),
                    Span::styled("[↑↓] scroll", dim),
                ]),
            }
        };

        let border = Style::default().fg(style.text_dim);
        let block = Block::default()
            .borders(Borders::TOP)
            .border_style(border);
        let inner = block.inner(area);
        frame.render_widget(block, area);

        let p = Paragraph::new(Text::from(line));
        frame.render_widget(p, inner);
    }

    fn render_slash_menu(&self, frame: &mut Frame, style: &StyleToken) {
        let area = frame.area();
        let input_y = area.height.saturating_sub(3);
        let popup_width = area.width.min(60);
        let popup_height = input_y.saturating_sub(1).clamp(5, 22);

        let y = input_y.saturating_sub(popup_height);
        let popup_area = Rect {
            x: 0,
            y,
            width: popup_width,
            height: popup_height,
        };

        let label = if self.in_submenu {
            self.active_command.unwrap_or("Options")
        } else {
            "Commands"
        };

        let mut menu = SlashMenu::new(DEMO_COMMANDS)
            .filter(&self.slash_filter)
            .selected(self.slash_selected)
            .visible(true)
            .max_visible(popup_height.saturating_sub(2) as usize)
            .label(label)
            .style(style.clone());

        if self.in_submenu {
            menu = menu.show_options(&self.active_options);
        }

        frame.render_widget(&menu, popup_area);
    }
}

fn approx_line_count(text: &str, width: usize) -> usize {
    if width == 0 {
        return 1;
    }
    let w = width.max(1);
    text.lines()
        .map(|l| {
            let line_len = l.chars().count();
            if line_len == 0 {
                1
            } else {
                line_len.div_ceil(w)
            }
        })
        .sum()
}

fn generate_response(_model: &str, _temperature: &str) -> String {
    let responses = [
        "Great question! Here's what I'd recommend based on the codebase. The architecture follows clean separation of concerns, with core logic in `src/` and examples in `examples/`. The key insight is leveraging Rust's type system to make invalid states unrepresentable — this eliminates entire categories of bugs at compile time.",
        "I've looked at the code. Here's my analysis:\n\n1. Module structure is well-organized with clear boundaries\n2. The widget system follows the composable builder pattern, idiomatic for Rust TUI frameworks\n3. The streaming text widget's character-by-character rendering creates the typewriter effect\n\nWould you like me to suggest improvements?",
        "Here's a pattern I often use:\n\n```rust\nfn process<T, F>(items: Vec<T>, mut f: F) -> Vec<T::Output>\nwhere\n    T: IntoIterator,\n    F: FnMut(T::Item) -> T::Output,\n{\n    items.into_iter().flat_map(|it| it.into_iter().map(&mut f)).collect()\n}\n```\n\nThis is completely generic over container type and transformation.",
        "That's a nuanced topic. Let me break it down:\n\n- **Performance**: The current approach is O(n), optimal for this use case\n- **Memory**: Heap allocations are bounded by lifetime\n- **Correctness**: Edge cases could use more pattern matching\n\nI'd suggest adding test cases around boundary conditions.",
        "I can help with that! The terminal UI layout follows a vertical stack:\n- Status bar at top for connection and model info\n- Main content scrolls through conversation messages\n- Footer displays keyboard shortcut hints\n- Input bar at bottom accepts user text\n\nSlash commands overlay as a popup above the input line.",
    ];
    let idx = (_model.len().wrapping_mul(7).wrapping_add(_temperature.len().wrapping_mul(3)))
        % responses.len();
    responses[idx].to_string()
}


