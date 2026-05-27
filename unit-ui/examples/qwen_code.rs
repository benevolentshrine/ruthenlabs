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

const BG: Color = Color::Rgb(28, 28, 32);
const ORANGE: Color = Color::Rgb(255, 106, 0);
const ACCENT: Color = Color::Rgb(255, 130, 50);
const DIM: Color = Color::Rgb(120, 120, 130);
const TEXT: Color = Color::Rgb(220, 220, 225);

fn run(mut terminal: DefaultTerminal) -> io::Result<()> {
    let qwen = StyleToken::builder()
        .accent(ORANGE)
        .text(TEXT)
        .text_dim(DIM)
        .success(ACCENT)
        .thinking(Color::Rgb(255, 200, 100))
        .build();

    let mut frame_count = 0;
    let mut scroll_offset: usize = 0;
    let mut typing_chars: usize = 0;
    let mut messages: Vec<Message> = Vec::new();
    let mut streaming = false;
    let mut prompt_idx = 0;
    let mut input_buf = String::new();

    let prompts = [
        "写一个 python 爬虫",
        "explain rust ownership",
        "optimize this sql query",
    ];

    let _responses = [
        "\
**Python 爬虫示例**

```python
import requests
from bs4 import BeautifulSoup

def crawl(url: str) -> str:
    resp = requests.get(url)
    soup = BeautifulSoup(resp.text, 'html.parser')
    return soup.get_text()

print(crawl('https://example.com'))
```

依赖: `pip install requests beautifulsoup4`",
        "\
**Rust Ownership Rules**

1. Each value has exactly one owner
2. When the owner goes out of scope, the value is dropped
3. You can have either one mutable reference or many immutable references

```rust
let s = String::from(\"hello\");  // s owns the string
let t = s;                       // ownership moves to t
// println!(\"{}\", s);          // error: s is moved
```",
        "\
**Optimized Query**

```sql
-- Before: slow full scan
SELECT * FROM orders
WHERE status = 'active'
AND created_at > NOW() - INTERVAL '7 days';

-- After: index scan
CREATE INDEX idx_orders_status_created
ON orders (status, created_at);

EXPLAIN ANALYZE
SELECT id, customer_id, total
FROM orders
WHERE status = 'active'
AND created_at > NOW() - INTERVAL '7 days';
```

Index scan reduces time from 2.3s to 12ms.",
    ];

    messages.push(Message {
        content: "Qwen Code ready. Enter to ask, ↑↓ scroll, q quit.".to_string(),
        role: Role::Assistant,
    });

    loop {
        terminal.draw(|frame| {
            draw(
                frame, &messages, scroll_offset, typing_chars, streaming,
                frame_count, &input_buf, &qwen,
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
    _frame_count: usize,
    input_buf: &str,
    qwen: &StyleToken,
) {
    let [header, chat, input_area] = Layout::vertical([
        Constraint::Length(2),
        Constraint::Fill(1),
        Constraint::Length(2),
    ])
    .areas(frame.area());

    let bg = Style::default().bg(BG);
    let clear = Paragraph::new("").style(bg);
    frame.render_widget(clear, frame.area());

    draw_header(frame, header, messages.len(), qwen);
    draw_chat(frame, chat, messages, scroll_offset, typing_chars, streaming, qwen);
    draw_prompt(frame, input_area, input_buf, streaming, qwen);
}

fn draw_header(frame: &mut Frame, area: Rect, msg_count: usize, _qwen: &StyleToken) {
    let block = Block::default()
        .borders(Borders::BOTTOM)
        .style(Style::default().fg(ORANGE));
    let inner = block.inner(area);
    frame.render_widget(block, area);

    let txt = format!(
        "  qwen  ●  Qwen3-Coder 480B  ●  {} msgs  ●  ↑↓ scroll",
        msg_count
    );
    let p = Paragraph::new(txt).style(Style::default().fg(TEXT));
    frame.render_widget(p, inner);
}

fn draw_chat(
    frame: &mut Frame,
    area: Rect,
    messages: &[Message],
    scroll_offset: usize,
    typing_chars: usize,
    streaming: bool,
    _qwen: &StyleToken,
) {
    let mut y = 0u16;

    for i in scroll_offset..messages.len() {
        if y >= area.height {
            break;
        }

        let msg = &messages[i];

        let (label, label_color) = match msg.role {
            Role::User => ("You", ORANGE),
            Role::Assistant => ("Qwen", ACCENT),
            Role::System => ("sys", DIM),
        };

        let label_p = Paragraph::new(format!(" {}", label))
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
            x: area.x + 2, y: area.y + y, width: area.width.saturating_sub(4), height: h,
        });
        y += 5;
    }
}

fn draw_prompt(
    frame: &mut Frame,
    area: Rect,
    input_buf: &str,
    streaming: bool,
    _qwen: &StyleToken,
) {
    let block = Block::default()
        .borders(Borders::TOP)
        .style(Style::default().fg(DIM));
    let inner = block.inner(area);
    frame.render_widget(block, area);

    let display = if streaming {
        " qwen is thinking...".to_string()
    } else if input_buf.is_empty() {
        " Ask Qwen anything...".to_string()
    } else {
        format!(" {}", input_buf)
    };

    let p = Paragraph::new(display)
        .style(Style::default().fg(if streaming { DIM } else { ORANGE }));
    frame.render_widget(p, inner);
}
