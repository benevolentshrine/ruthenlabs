use std::io::stdout;
use std::time::Instant;

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
        .build()
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    enable_raw_mode()?;
    let mut terminal = Terminal::new(CrosstermBackend::new(stdout()))?;
    execute!(terminal.backend_mut(), EnterAlternateScreen)?;

    let s = style();
    let started = Instant::now();
    let mut messages: Vec<(&str, Role)> = vec![(
        "Hello! I'm Unit AI. How can I help you today?",
        Role::Assistant,
    )];
    let mut input_text = String::from("");
    loop {
        terminal.draw(|f| {
            let area = f.area();
            let bg = Style::default().bg(s.surface);
            f.render_widget(Paragraph::new("").style(bg), area);

            let [top, mid, bot] = Layout::vertical([
                Constraint::Length(1),
                Constraint::Min(1),
                Constraint::Length(3),
            ])
            .areas(area);

            let bar = StatusBar::new()
                .provider("Unit AI")
                .model("assistant-v1")
                .connection(ConnectionStatus::Connected)
                .started_at(started)
                .token_count(42)
                .style(s.clone());
            f.render_widget(&bar, top);

            let block = Block::default()
                .borders(Borders::ALL)
                .border_style(Style::default().fg(s.text_dim));
            let inner = block.inner(mid);
            f.render_widget(&block, mid);

            let mut y = inner.y + 1;
            for &(content, role) in &messages {
                let h = content.lines().count() as u16 + 2;
                if y + h > inner.bottom() {
                    break;
                }
                let bubble = MessageBubble::new(content, role).style(s.clone());
                f.render_widget(
                    &bubble,
                    Rect {
                        x: inner.x + 1,
                        y,
                        width: inner.width.saturating_sub(2),
                        height: h,
                    },
                );
                y += h + 1;
            }

            let input = BasicInput::new(&input_text)
                .placeholder("Type a message...")
                .style(s.clone());
            f.render_widget(&input, bot);
        })?;

        if crossterm::event::poll(std::time::Duration::from_millis(100))? {
            if let crossterm::event::Event::Key(key) = crossterm::event::read()? {
                match key.code {
                    crossterm::event::KeyCode::Char('q') => break,
                    crossterm::event::KeyCode::Enter => {
                        if !input_text.is_empty() {
                            let msg = std::mem::take(&mut input_text);
                            messages.push((Box::leak(msg.into_boxed_str()), Role::User));
                            let response = format!(
                                "I received: \"{}\". This is a simulated response.",
                                &messages.last().map(|(t, _)| *t).unwrap_or("")
                            );
                            messages.push((Box::leak(response.into_boxed_str()), Role::Assistant));
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
