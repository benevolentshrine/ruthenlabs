use std::io::stdout;
use std::time::{Duration, Instant};

use crossterm::execute;
use crossterm::terminal::{
    disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen,
};
use ratatui::backend::CrosstermBackend;
use ratatui::layout::{Constraint, Layout, Rect};
use ratatui::style::{Color, Style};
use ratatui::widgets::{Block, Borders, Paragraph};
use ratatui::Terminal;

use unit_ui::prelude::*;
use unit_ui::style::StyleToken;

fn style() -> StyleToken {
    StyleToken::builder()
        .accent(Color::Rgb(66, 133, 244))
        .text(Color::Rgb(230, 230, 245))
        .text_dim(Color::Rgb(110, 115, 140))
        .success(Color::Rgb(60, 200, 120))
        .surface(Color::Rgb(25, 25, 40))
        .thinking(Color::Rgb(180, 180, 100))
        .error(Color::Rgb(220, 60, 60))
        .build()
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    enable_raw_mode()?;
    let mut terminal = Terminal::new(CrosstermBackend::new(stdout()))?;
    execute!(terminal.backend_mut(), EnterAlternateScreen)?;

    let s = style();
    let started = Instant::now();
    let mut frame = 0u64;
    let mut input_text = String::new();
    let mut mode = 0u16;
    let msgs = [
        (
            "Hi! I can help you code. What are you working on?",
            Role::Assistant,
        ),
        ("I need to refactor the auth module.", Role::User),
        ("I'll search for relevant files first.", Role::Assistant),
    ];

    loop {
        frame += 1;
        terminal.draw(|f| {
            let area = f.area();
            let bg = Style::default().bg(s.surface);
            f.render_widget(Paragraph::new("").style(bg), area);

            let [top, chat, tool, status, bot] = Layout::vertical([
                Constraint::Length(1),
                Constraint::Min(3),
                Constraint::Length(5),
                Constraint::Length(3),
                Constraint::Length(3),
            ])
            .areas(area);

            let bar = StatusBar::new()
                .provider("Unit AI")
                .model("assistant-v1")
                .connection(ConnectionStatus::Connected)
                .started_at(started)
                .token_count(142)
                .style(s.clone());
            f.render_widget(&bar, top);

            let block = Block::default()
                .borders(Borders::ALL)
                .border_style(Style::default().fg(s.text_dim));
            let inner = block.inner(chat);
            f.render_widget(&block, chat);

            let mut y = inner.y;
            for &(content, role) in &msgs {
                let h = content.lines().count() as u16 + 2;
                if y + h > inner.bottom() {
                    break;
                }
                f.render_widget(
                    MessageBubble::new(content, role).style(s.clone()),
                    Rect {
                        x: inner.x + 1,
                        y,
                        width: inner.width.saturating_sub(2),
                        height: h,
                    },
                );
                y += h + 1;
            }

            if mode == 0 {
                let tb = ThinkingBlock::new()
                    .label("Reasoning about auth module")
                    .state(ThinkingState::Thinking)
                    .expanded(true)
                    .frame_index(frame as usize)
                    .elapsed(Duration::from_millis(frame * 50))
                    .style(s.clone());
                f.render_widget(&tb, tool);
            } else {
                let card = ToolCallCard::new()
                    .tool_name("search_files")
                    .arguments("{\"pattern\": \"auth*\", \"path\": \"src/\"}")
                    .status(if mode < 5 {
                        ToolStatus::Running
                    } else {
                        ToolStatus::Success
                    })
                    .duration(Duration::from_millis(mode as u64 * 100))
                    .style(s.clone());
                f.render_widget(&card, status);

                let card2 = ToolCallCard::new()
                    .tool_name("read_file")
                    .arguments("{\"path\": \"src/auth/login.rs\"}")
                    .status(ToolStatus::Pending)
                    .style(s.clone());
                f.render_widget(&card2, tool);
            }

            let input = BasicInput::new(&input_text)
                .placeholder("Ask or type a command...")
                .style(s.clone());
            f.render_widget(&input, bot);
        })?;

        if crossterm::event::poll(std::time::Duration::from_millis(80))? {
            if let crossterm::event::Event::Key(key) = crossterm::event::read()? {
                match key.code {
                    crossterm::event::KeyCode::Char('q') => break,
                    crossterm::event::KeyCode::Enter => {
                        mode += 1;
                        if mode > 8 {
                            mode = 0;
                        }
                    }
                    crossterm::event::KeyCode::Char(c) => input_text.push(c),
                    crossterm::event::KeyCode::Backspace => {
                        input_text.pop();
                    }
                    _ => {}
                }
            }
        }
    }

    disable_raw_mode()?;
    execute!(terminal.backend_mut(), LeaveAlternateScreen)?;
    Ok(())
}
