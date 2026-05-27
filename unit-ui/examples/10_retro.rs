use std::io::stdout;
use std::time::Instant;

use crossterm::execute;
use crossterm::terminal::{disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen};
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
        .accent(Color::Rgb(0, 220, 0))
        .text(Color::Rgb(0, 255, 0))
        .text_dim(Color::Rgb(0, 140, 0))
        .success(Color::Rgb(0, 255, 100))
        .surface(Color::Rgb(0, 8, 0))
        .error(Color::Rgb(255, 50, 50))
        .thinking(Color::Rgb(180, 255, 0))
        .provider(Color::Rgb(0, 200, 200))
        .build()
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    enable_raw_mode()?;
    let mut terminal = Terminal::new(CrosstermBackend::new(stdout()))?;
    execute!(terminal.backend_mut(), EnterAlternateScreen)?;

    let s = style();
    let started = Instant::now();
    let mut frame_count: usize = 0;
    let mut boot_log: Vec<String> = vec![
        "SYSTEM INITIALIZED".to_string(),
        "KERNEL LOADED".to_string(),
        "AI CORE ONLINE".to_string(),
        "WELCOME TO RETRO TERMINAL v2.0".to_string(),
    ];
    let mut input_text = String::from("");

    loop {
        frame_count += 1;

        if frame_count % 20 == 0 {
            boot_log.push(format!("[{}] PROCESSING...", frame_count));
        }

        terminal.draw(|f| {
            let area = f.area();
            let bg = Style::default().bg(s.surface);
            f.render_widget(Paragraph::new("").style(bg), area);

            let [top, mid, bot] = Layout::vertical([
                Constraint::Length(1), Constraint::Min(1), Constraint::Length(3),
            ]).areas(area);

            let bar = StatusBar::new()
                .provider("RETRO-AI").model("legacy")
                .connection(ConnectionStatus::Connected).started_at(started)
                .style(s.clone());
            f.render_widget(&bar, top);

            let outer = Block::default().borders(Borders::ALL)
                .border_style(Style::default().fg(s.accent));
            let outer_inner = outer.inner(mid);
            outer.render(mid, f.buffer_mut());

            let inner_block = Block::default().borders(Borders::ALL)
                .border_style(Style::default().fg(s.text_dim))
                .title(" SHELL ");
            let inner = inner_block.inner(outer_inner);
            inner_block.render(outer_inner, f.buffer_mut());

            let mut y = inner.y;
            for line in boot_log.iter().rev().take(inner.height as usize).rev() {
                if y >= inner.bottom() { break; }
                let fg = if line.contains("ERROR") || line.contains("FAIL") {
                    s.error
                } else if line.contains("INIT") || line.contains("LOADED") || line.contains("ONLINE") {
                    s.success
                } else if line.contains("WELCOME") {
                    s.thinking
                } else {
                    s.text
                };
                let paragraph = Paragraph::new(line.as_str()).style(Style::default().fg(fg));
                f.render_widget(&paragraph, Rect { x: inner.x + 1, y, width: inner.width.saturating_sub(2), height: 1 });
                y += 1;
            }

            let dots = ThinkingDots::new().label("AWAITING INPUT").frame_index(frame_count).style(s.clone());
            f.render_widget(&dots, Rect { x: inner.x + 1, y: inner.bottom().saturating_sub(1), width: inner.width.saturating_sub(2), height: 1 });

            let input = BasicInput::new(&input_text).placeholder("retro> ").style(s.clone());
            f.render_widget(&input, bot);
        })?;

        if crossterm::event::poll(std::time::Duration::from_millis(100))? {
            if let crossterm::event::Event::Key(key) = crossterm::event::read()? {
                match key.code {
                    crossterm::event::KeyCode::Char('q') => break,
                    crossterm::event::KeyCode::Enter => {
                        if !input_text.is_empty() {
                            let cmd = std::mem::take(&mut input_text);
                            boot_log.push(format!("> {}", cmd));
                            boot_log.push(format!("  EXECUTING: {}...", cmd));
                            boot_log.push("  STATUS: OK".to_string());
                        }
                    }
                    crossterm::event::KeyCode::Char(c) => input_text.push(c),
                    crossterm::event::KeyCode::Backspace => { input_text.pop(); }
                    _ => {}
                }
            }
        }
    }

    disable_raw_mode()?;
    execute!(terminal.backend_mut(), LeaveAlternateScreen)?;
    Ok(())
}
