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
        .accent(Color::Rgb(86, 156, 214))
        .text(Color::Rgb(212, 212, 212))
        .text_dim(Color::Rgb(128, 128, 128))
        .success(Color::Rgb(80, 200, 120))
        .surface(Color::Rgb(30, 30, 30))
        .error(Color::Rgb(240, 80, 80))
        .thinking(Color::Rgb(220, 200, 80))
        .build()
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    enable_raw_mode()?;
    let mut terminal = Terminal::new(CrosstermBackend::new(stdout()))?;
    execute!(terminal.backend_mut(), EnterAlternateScreen)?;

    let s = style();
    let started = Instant::now();
    let tabs = ["Chat", "Problems", "Output", "Terminal"];
    let mut active_tab: usize = 0;
    let mut messages: Vec<(&str, Role)> =
        vec![("AI assistant ready in Chat tab.", Role::Assistant)];
    let mut input_text = String::from("");

    loop {
        terminal.draw(|f| {
            let area = f.area();
            let bg = Style::default().bg(s.surface);
            f.render_widget(Paragraph::new("").style(bg), area);

            let [tabs_area, body, status, bot] = Layout::vertical([
                Constraint::Length(1),
                Constraint::Min(1),
                Constraint::Length(1),
                Constraint::Length(3),
            ])
            .areas(area);

            for (i, tab) in tabs.iter().enumerate() {
                let x = tabs_area.x + i as u16 * 14;
                let fg = if i == active_tab {
                    s.accent
                } else {
                    s.text_dim
                };
                let style = if i == active_tab {
                    Style::default().fg(fg).bg(s.surface)
                } else {
                    Style::default().fg(fg)
                };
                let tab_text = Paragraph::new(format!(" {} ", tab)).style(style);
                f.render_widget(
                    &tab_text,
                    Rect {
                        x,
                        y: tabs_area.y,
                        width: 13,
                        height: 1,
                    },
                );
            }

            let [sidebar, main_area] =
                Layout::horizontal([Constraint::Length(18), Constraint::Min(1)]).areas(body);

            let sb_block = Block::default()
                .borders(Borders::ALL)
                .border_style(Style::default().fg(s.text_dim))
                .title(" Files ");
            sb_block.render(sidebar, f.buffer_mut());

            let files = ["src/main.rs", "src/lib.rs", "config.toml", "README.md"];
            for (i, file) in files.iter().enumerate() {
                let y = sidebar.y + 1 + i as u16;
                let icon = if i == 0 { "●" } else { " " };
                let line = Paragraph::new(format!(" {} {}", icon, file))
                    .style(Style::default().fg(s.text_dim));
                f.render_widget(
                    &line,
                    Rect {
                        x: sidebar.x + 1,
                        y,
                        width: sidebar.width.saturating_sub(2),
                        height: 1,
                    },
                );
            }

            let block = Block::default()
                .borders(Borders::ALL)
                .border_style(Style::default().fg(s.text_dim))
                .title(format!(" {} ", tabs[active_tab]));
            let inner = block.inner(main_area);
            block.render(main_area, f.buffer_mut());

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

            let bar = StatusBar::new()
                .provider("IDE")
                .model("panel")
                .connection(ConnectionStatus::Connected)
                .started_at(started)
                .style(s.clone());
            f.render_widget(&bar, status);

            let input = BasicInput::new(&input_text)
                .placeholder("Message...")
                .style(s.clone());
            f.render_widget(&input, bot);
        })?;

        if crossterm::event::poll(std::time::Duration::from_millis(100))? {
            if let crossterm::event::Event::Key(key) = crossterm::event::read()? {
                match key.code {
                    crossterm::event::KeyCode::Char('q') => break,
                    crossterm::event::KeyCode::Left => active_tab = active_tab.saturating_sub(1),
                    crossterm::event::KeyCode::Right => {
                        active_tab = (active_tab + 1).min(tabs.len() - 1)
                    }
                    crossterm::event::KeyCode::Enter => {
                        if !input_text.is_empty() {
                            let msg = std::mem::take(&mut input_text);
                            messages.push((Box::leak(msg.into_boxed_str()), Role::User));
                            let resp = format!("[{} tab] response received.", tabs[active_tab]);
                            messages.push((Box::leak(resp.into_boxed_str()), Role::Assistant));
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
