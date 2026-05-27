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

const BG: Color = Color::Rgb(25, 30, 35);
const GREEN: Color = Color::Rgb(52, 168, 83);
const TEAL: Color = Color::Rgb(68, 190, 180);
const DIM: Color = Color::Rgb(100, 120, 120);
const TEXT: Color = Color::Rgb(210, 220, 220);

fn run(mut terminal: DefaultTerminal) -> io::Result<()> {
    let agy = StyleToken::builder()
        .accent(GREEN)
        .text(TEXT)
        .text_dim(DIM)
        .success(TEAL)
        .thinking(Color::Rgb(251, 188, 4))
        .build();

    let mut frame_count = 0;
    let mut scroll_offset: usize = 0;
    let mut typing_chars: usize = 0;
    let mut messages: Vec<Message> = Vec::new();
    let mut streaming = false;
    let mut prompt_idx = 0;
    let mut input_buf = String::new();

    let prompts = [
        "optimize this dockerfile",
        "explain the git workflow",
        "write a makefile",
    ];

    let _responses = [
        "\
**Optimized Dockerfile**

```dockerfile
FROM rust:1.85-slim AS builder
WORKDIR /app
COPY Cargo.toml Cargo.lock ./
RUN cargo build --release

FROM debian:bookworm-slim
COPY --from=builder /app/target/release/app /app
CMD [\"/app\"]
```

Multi-stage build reduces image size by ~80%.",
        "\
**Git Workflow: feature branches**

```bash
git checkout -b feat/new-feature
# ... make changes ...
git add .
git commit -m \"feat: add new feature\"
git checkout main
git merge feat/new-feature
```

Use `git rebase -i` to clean up commits before merging.",
        "\
```makefile
.PHONY: build test clean

build:
\tcargo build --release

test:
\tcargo test --all

clean:
\tcargo clean

run: build
\t./target/release/app
```",
    ];

    messages.push(Message {
        content: "Antigravity CLI ready. Press Enter to ask something, ↑↓ scroll, q quit.".to_string(),
        role: Role::Assistant,
    });

    loop {
        terminal.draw(|frame| {
            draw(
                frame, &messages, scroll_offset, typing_chars, streaming,
                frame_count, &input_buf, &agy,
            )
        })?;

        if event::poll(Duration::from_millis(40))? {
            if let Event::Key(key) = event::read()? {
                match key.code {
                    KeyCode::Esc | KeyCode::Char('q') => break,
                    KeyCode::Up => {
                        if scroll_offset > 0 {
                            scroll_offset -= 1;
                        }
                    }
                    KeyCode::Down => {
                        let max = messages.len().saturating_sub(1);
                        if scroll_offset < max {
                            scroll_offset += 1;
                        }
                    }
                    KeyCode::Enter => {
                        if !streaming && prompt_idx < prompts.len() {
                            messages.push(Message {
                                content: prompts[prompt_idx].to_string(),
                                role: Role::User,
                            });
                            streaming = true;
                            typing_chars = 0;
                            scroll_offset = 0;
                            prompt_idx += 1;
                            input_buf.clear();
                        }
                    }
                    KeyCode::Char(c) => {
                        if !streaming {
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

        if streaming {
            if let Some(last) = messages.last() {
                if typing_chars < last.content.len() {
                    typing_chars += 3;
                } else {
                    streaming = false;
                }
            }
        }
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn draw(
    frame: &mut Frame,
    messages: &[Message],
    scroll_offset: usize,
    typing_chars: usize,
    streaming: bool,
    frame_count: usize,
    input_buf: &str,
    agy: &StyleToken,
) {
    let [header, chat, input_area] = Layout::vertical([
        Constraint::Length(6),
        Constraint::Fill(1),
        Constraint::Length(2),
    ])
    .areas(frame.area());

    let bg = Style::default().bg(BG);
    let clear = Paragraph::new("").style(bg);
    frame.render_widget(clear, frame.area());

    draw_header(frame, header, agy, frame_count);
    draw_chat(frame, chat, messages, scroll_offset, typing_chars, streaming, frame_count, agy);
    draw_prompt(frame, input_area, input_buf, streaming, agy);
}

fn draw_header(frame: &mut Frame, area: Rect, _agy: &StyleToken, _frame_count: usize) {
    let header_art = [
        "      ▄▀▀▄  Antigravity CLI 1.0.0",
        "     ▀▀▀▀▀▀  dev@antigravity.google",
        "    ▀▀▀▀▀▀▀▀  Gemini 3.5 Flash (High)",
        "   ▄▀▀ ▀▀▄  ~/project",
        "  ▄▀▀     ▀▀  Session active",
    ];

    for (i, line) in header_art.iter().enumerate() {
        let y = area.y + i as u16;
        if y >= area.y + area.height {
            break;
        }
        let color = if i == 0 {
            GREEN
        } else if i == 2 {
            TEAL
        } else {
            DIM
        };
        let p = Paragraph::new(*line)
            .style(Style::default().fg(color));
        frame.render_widget(p, Rect {
            x: area.x, y, width: area.width, height: 1,
        });
    }

    let sep = Paragraph::new("─".repeat(area.width as usize))
        .style(Style::default().fg(DIM));
    frame.render_widget(sep, Rect {
        x: area.x, y: area.y + area.height - 1, width: area.width, height: 1,
    });
}

fn draw_chat(
    frame: &mut Frame,
    area: Rect,
    messages: &[Message],
    scroll_offset: usize,
    typing_chars: usize,
    streaming: bool,
    _frame_count: usize,
    _agy: &StyleToken,
) {
    let mut y = 0u16;

    for i in scroll_offset..messages.len() {
        if y >= area.height {
            break;
        }

        let msg = &messages[i];

        let (label, label_color) = match msg.role {
            Role::User => ("You", GREEN),
            Role::Assistant => ("agy", TEAL),
            Role::System => ("sys", DIM),
        };

        let label_p = Paragraph::new(format!(" {} ▸", label))
            .style(Style::default().fg(label_color));
        frame.render_widget(label_p, Rect {
            x: area.x, y: area.y + y, width: 20, height: 1,
        });
        y += 1;
        if y >= area.height {
            break;
        }

        let is_streaming = streaming && i == messages.len() - 1;
        let content = if is_streaming {
            msg.content.chars().take(typing_chars).collect::<String>()
        } else {
            msg.content.clone()
        };

        let text_style = Style::default().fg(TEXT);
        let p = Paragraph::new(content)
            .style(text_style)
            .wrap(Wrap { trim: false });
        let h = 4u16.min(area.height.saturating_sub(y));
        frame.render_widget(p, Rect {
            x: area.x + 4, y: area.y + y, width: area.width.saturating_sub(6), height: h,
        });
        y += 5;
    }
}

fn draw_prompt(
    frame: &mut Frame,
    area: Rect,
    input_buf: &str,
    streaming: bool,
    _agy: &StyleToken,
) {
    let top = Style::default().fg(Color::Rgb(35, 45, 45));
    let line = Paragraph::new("").style(top);
    frame.render_widget(line, area);

    let block = Block::default()
        .borders(Borders::TOP)
        .style(Style::default().fg(DIM));
    let inner = block.inner(area);
    frame.render_widget(block, area);

    let display = if streaming {
        "▸ agy is working...".to_string()
    } else if input_buf.is_empty() {
        "▸  Ask agy anything...".to_string()
    } else {
        format!("▸ {}", input_buf)
    };

    let p = Paragraph::new(display)
        .style(Style::default().fg(if streaming { DIM } else { GREEN }));
    frame.render_widget(p, inner);
}
