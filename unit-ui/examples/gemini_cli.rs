use std::io;
use std::time::Duration;

use crossterm::event::{self, Event, KeyCode};
use ratatui::layout::{Constraint, Layout, Rect};
use ratatui::style::{Color, Style};
use ratatui::widgets::{Block, Borders, Paragraph, Wrap};
use ratatui::{DefaultTerminal, Frame};

use unit_ui::prelude::*;

#[derive(Clone)]
struct Message {
    content: String,
    role: Role,
}

fn main() -> io::Result<()> {
    let terminal = ratatui::init();
    let result = run(terminal);
    ratatui::restore();
    result
}

fn run(mut terminal: DefaultTerminal) -> io::Result<()> {
    let gemini = StyleToken::builder()
        .accent(Color::Rgb(66, 133, 244))
        .text(Color::Rgb(232, 234, 237))
        .text_dim(Color::Rgb(154, 160, 166))
        .success(Color::Rgb(138, 180, 248))
        .thinking(Color::Rgb(251, 188, 4))
        .build();

    let user_style = StyleToken::builder()
        .accent(Color::Rgb(66, 133, 244))
        .text(Color::Rgb(232, 234, 237))
        .success(Color::Rgb(138, 180, 248))
        .build();

    let mut frame_count = 0;
    let mut scroll_offset: usize = 0;
    let mut typing_chars: usize = 0;
    let mut messages: Vec<Message> = Vec::new();
    let mut streaming_done = true;
    let mut input_buf = String::new();
    let mut prompt_idx = 0;

    let prompts = [
        "how do i make a rust cli?",
        "show me a websocket server example",
        "explain async/await in rust",
    ];

    let responses = [
        "\
# Step 1 — Add dependencies

```toml
[dependencies]
clap = { version = \"4.5\", features = [\"derive\"] }
```

# Step 2 — Define your CLI

```rust
use clap::Parser;

#[derive(Parser)]
#[command(name = \"mycli\")]
struct Cli {
    input: String,
    #[arg(short, long)]
    verbose: bool,
}
```

# Step 3 — Parse and run

```rust
fn main() {
    let cli = Cli::parse();
    println!(\"Input: {}\", cli.input);
}
```",
        "\
# WebSocket server with tokio-tungstenite

```toml
[dependencies]
tokio = { version = \"1\", features = [\"full\"] }
tokio-tungstenite = \"0.21\"
futures-util = \"0.3\"
```

# Server code

```rust,ignore
use tokio::net::TcpListener;
use tokio_tungstenite::accept_async;
use futures_util::StreamExt;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let listener = TcpListener::bind(\"127.0.0.1:8080\").await?;
    while let Ok((stream, _)) = listener.accept().await {
        tokio::spawn(async move {
            let ws_stream = accept_async(stream).await.unwrap();
            let (_, mut outgoing) = ws_stream.split();
        });
    }
    Ok(())
}
```",
        "\
# Async/await in Rust

Async functions return `Future`s. You `.await` them.

```rust
use tokio::time::sleep;

async fn fetch_data() -> String {
    sleep(Duration::from_secs(1)).await;
    \"data\".to_string()
}

#[tokio::main]
async fn main() {
    let result = fetch_data().await;
    println!(\"{result}\");
}
```

Key points:
- `async fn` returns a `Future`
- `.await` yields until the future completes
- An executor (tokio) polls futures",
    ];

    messages.push(Message {
        content: "Welcome to Gemini CLI mock. Press **Enter** to ask a question, ↑↓ to scroll, q to quit.".to_string(),
        role: Role::Assistant,
    });

    loop {
        terminal.draw(|frame| {
            draw(
                frame, &messages, scroll_offset, typing_chars, streaming_done,
                frame_count, &input_buf, &gemini, &user_style,
            )
        })?;

        if event::poll(Duration::from_millis(30))? {
            if let Event::Key(key) = event::read()? {
                match key.code {
                    KeyCode::Esc | KeyCode::Char('q') => break,
                    KeyCode::Up => {
                        if scroll_offset > 0 {
                            scroll_offset -= 1;
                        }
                    }
                    KeyCode::Down => {
                        let max_scroll = messages.len().saturating_sub(1);
                        if scroll_offset < max_scroll {
                            scroll_offset += 1;
                        }
                    }
                    KeyCode::Enter => {
                        if streaming_done && prompt_idx < prompts.len() {
                            messages.push(Message {
                                content: prompts[prompt_idx].to_string(),
                                role: Role::User,
                            });
                            messages.push(Message {
                                content: responses[prompt_idx].to_string(),
                                role: Role::Assistant,
                            });
                            typing_chars = 0;
                            streaming_done = false;
                            scroll_offset = 0;
                            prompt_idx += 1;
                            input_buf.clear();
                        }
                    }
                    KeyCode::Char(c) => {
                        if streaming_done {
                            input_buf.push(c);
                        }
                    }
                    KeyCode::Backspace => {
                        input_buf.pop();
                    }
                    _ => {}
                }
            }
        }

        frame_count += 1;
        if !streaming_done {
            if let Some(last) = messages.last() {
                if typing_chars < last.content.len() {
                    typing_chars += 3;
                } else {
                    streaming_done = true;
                }
            }
        }
    }
    Ok(())
}

fn total_tokens(messages: &[Message]) -> usize {
    let mut n = 0;
    for msg in messages {
        n += msg.content.len() / 3;
    }
    n
}

#[allow(clippy::too_many_arguments)]
fn draw(
    frame: &mut Frame,
    messages: &[Message],
    scroll_offset: usize,
    typing_chars: usize,
    streaming_done: bool,
    _frame_count: usize,
    input_buf: &str,
    gemini: &StyleToken,
    user_style: &StyleToken,
) {
    let [header, chat, input_area] = Layout::vertical([
        Constraint::Length(2),
        Constraint::Fill(1),
        Constraint::Length(3),
    ])
    .areas(frame.area());

    draw_header(frame, header, messages, gemini);
    draw_chat(frame, chat, messages, scroll_offset, typing_chars, streaming_done, gemini, user_style);
    draw_input_bar(frame, input_area, input_buf, streaming_done, gemini);
}

fn draw_header(frame: &mut Frame, area: Rect, messages: &[Message], gemini: &StyleToken) {
    let block = Block::default()
        .borders(Borders::BOTTOM)
        .style(Style::default().fg(gemini.accent));
    let inner = block.inner(area);
    frame.render_widget(block, area);

    let txt = format!(
        "  gemini  ●  Gemini 2.5 Flash  ●  {} tokens  ●  {} msgs  (scroll: ↑↓)",
        total_tokens(messages),
        messages.len()
    );
    let p = Paragraph::new(txt).style(Style::default().fg(gemini.text));
    frame.render_widget(p, inner);
}

#[allow(clippy::too_many_arguments)]
fn draw_chat(
    frame: &mut Frame,
    area: Rect,
    messages: &[Message],
    scroll_offset: usize,
    typing_chars: usize,
    streaming_done: bool,
    gemini: &StyleToken,
    user_style: &StyleToken,
) {
    let bg = Style::default().bg(Color::Rgb(32, 33, 36));
    let clear = Paragraph::new("").style(bg);
    frame.render_widget(clear, area);

    let msg_height = 5;
    let visible_count = (area.height / msg_height) as usize;

    for i in 0..visible_count {
        let msg_idx = scroll_offset + i;
        if msg_idx >= messages.len() {
            break;
        }

        let msg = &messages[msg_idx];
        let is_last = msg_idx == messages.len() - 1 && !streaming_done;

        let y = area.y + (i as u16) * msg_height;
        let w = area.width.saturating_sub(2);

        let role_label = match msg.role {
            Role::User => "You",
            Role::Assistant => "Gemini",
            Role::System => "System",
        };

        let label_color = match msg.role {
            Role::User => user_style.accent,
            Role::Assistant => Color::Rgb(138, 180, 248),
            Role::System => gemini.text_dim,
        };

        let role_p = Paragraph::new(format!("  {}", role_label))
            .style(Style::default().fg(label_color));
        frame.render_widget(role_p, Rect { x: area.x, y, width: 12, height: 1 });

        let content = if is_last {
            msg.content.chars().take(typing_chars).collect::<String>()
        } else {
            msg.content.clone()
        };

        let text_color = match msg.role {
            Role::User => user_style.text,
            Role::Assistant => gemini.text,
            Role::System => gemini.text_dim,
        };
        let text_style = Style::default().fg(text_color);

        if is_last {
            let stream = StreamingText::new(&content)
                .thinking("Thinking about the best approach...")
                .visible_chars(typing_chars)
                .typing_speed(60)
                .style(if msg.role == Role::User { user_style.clone() } else { gemini.clone() });
            frame.render_widget(
                &stream,
                Rect { x: area.x + 2, y: y + 1, width: w, height: (msg_height - 1) as u16 },
            );
        } else {
            let p = Paragraph::new(content)
                .style(text_style)
                .wrap(Wrap { trim: false });
            frame.render_widget(
                p,
                Rect { x: area.x + 2, y: y + 1, width: w, height: (msg_height - 1) as u16 },
            );
        }
    }
}

fn draw_input_bar(
    frame: &mut Frame,
    area: Rect,
    input_buf: &str,
    streaming_done: bool,
    gemini: &StyleToken,
) {
    let block = Block::default()
        .borders(Borders::TOP)
        .style(Style::default().fg(gemini.accent));
    let inner = block.inner(area);
    frame.render_widget(block, area);

    let display = if !streaming_done {
        format!(" {}", "▸ Gemini is thinking...")
    } else if input_buf.is_empty() {
        format!(" {} Ask Gemini... (Enter to send)", "▸")
    } else {
        format!(" {}", input_buf)
    };

    let style = if streaming_done {
        Style::default().fg(gemini.text)
    } else {
        Style::default().fg(gemini.text_dim)
    };

    let p = Paragraph::new(display).style(style);
    frame.render_widget(p, inner);
}
