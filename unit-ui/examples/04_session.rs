use std::io::stdout;
use std::time::Instant;

use crossterm::execute;
use crossterm::terminal::{
    disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen,
};
use ratatui::backend::CrosstermBackend;
use ratatui::layout::{Constraint, Layout, Rect};
use ratatui::prelude::Widget;
use ratatui::style::{Color, Style};
use ratatui::widgets::{Block, Borders, Paragraph};
use ratatui::Terminal;

use unit_ui::prelude::*;
use unit_ui::style::StyleToken;

fn style() -> StyleToken {
    StyleToken::builder()
        .accent(Color::Rgb(140, 120, 255))
        .text(Color::Rgb(210, 210, 230))
        .text_dim(Color::Rgb(110, 110, 150))
        .success(Color::Rgb(100, 220, 180))
        .surface(Color::Rgb(28, 26, 40))
        .provider(Color::Rgb(160, 140, 255))
        .build()
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    enable_raw_mode()?;
    let mut terminal = Terminal::new(CrosstermBackend::new(stdout()))?;
    execute!(terminal.backend_mut(), EnterAlternateScreen)?;

    let s = style();
    let started = Instant::now();
    let sessions = ["Chat #1", "Chat #2", "Research", "Code Review"];
    let mut selected_session: usize = 0;
    let mut messages: Vec<(&str, Role)> = vec![("Welcome to session: Chat #1", Role::Assistant)];
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
                .provider("Sessions")
                .model("manager")
                .connection(ConnectionStatus::Connected)
                .started_at(started)
                .token_count(messages.len() as u64)
                .style(s.clone());
            f.render_widget(&bar, top);

            let [sidebar, main] =
                Layout::horizontal([Constraint::Length(22), Constraint::Min(1)]).areas(mid);

            let sb_block = Block::default()
                .borders(Borders::ALL)
                .border_style(Style::default().fg(s.accent))
                .title(" Sessions ");
            let sbi = sb_block.inner(sidebar);
            sb_block.render(sidebar, f.buffer_mut());

            for (i, name) in sessions.iter().enumerate() {
                let y = sbi.y + 1 + i as u16;
                let fg = if i == selected_session {
                    s.accent
                } else {
                    s.text_dim
                };
                let marker = if i == selected_session { "▶ " } else { "  " };
                let line =
                    Paragraph::new(format!("{}{}", marker, name)).style(Style::default().fg(fg));
                f.render_widget(
                    &line,
                    Rect {
                        x: sbi.x + 1,
                        y,
                        width: sbi.width.saturating_sub(2),
                        height: 1,
                    },
                );
            }

            let block = Block::default()
                .borders(Borders::ALL)
                .border_style(Style::default().fg(s.text_dim))
                .title(format!(" {} ", sessions[selected_session]));
            let inner = block.inner(main);
            block.render(main, f.buffer_mut());

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
                .placeholder("Message...")
                .style(s.clone());
            f.render_widget(&input, bot);
        })?;

        if crossterm::event::poll(std::time::Duration::from_millis(100))? {
            if let crossterm::event::Event::Key(key) = crossterm::event::read()? {
                match key.code {
                    crossterm::event::KeyCode::Char('q') => break,
                    crossterm::event::KeyCode::Up => {
                        selected_session = selected_session.saturating_sub(1)
                    }
                    crossterm::event::KeyCode::Down => {
                        selected_session = (selected_session + 1).min(sessions.len() - 1)
                    }
                    crossterm::event::KeyCode::Enter => {
                        if !input_text.is_empty() {
                            let msg = std::mem::take(&mut input_text);
                            messages.push((Box::leak(msg.into_boxed_str()), Role::User));
                            let reply = format!(
                                "Response in {}: acknowledged.",
                                sessions[selected_session]
                            );
                            messages.push((Box::leak(reply.into_boxed_str()), Role::Assistant));
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
