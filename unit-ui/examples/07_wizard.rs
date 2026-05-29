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
        .accent(Color::Rgb(70, 180, 220))
        .text(Color::Rgb(220, 230, 235))
        .text_dim(Color::Rgb(110, 140, 155))
        .success(Color::Rgb(60, 220, 130))
        .surface(Color::Rgb(22, 30, 38))
        .error(Color::Rgb(240, 90, 90))
        .thinking(Color::Rgb(180, 190, 80))
        .build()
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    enable_raw_mode()?;
    let mut terminal = Terminal::new(CrosstermBackend::new(stdout()))?;
    execute!(terminal.backend_mut(), EnterAlternateScreen)?;

    let s = style();
    let started = Instant::now();
    let steps = ["Provider", "Model", "API Key", "Theme", "Done"];
    let mut current_step: usize = 0;
    let mut input_text = String::from("");
    let mut setup_log: Vec<String> = Vec::new();
    let mut frame_count: usize = 0;

    loop {
        frame_count += 1;
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
                .provider("Setup Wizard")
                .model("installer")
                .connection(ConnectionStatus::Connected)
                .started_at(started)
                .style(s.clone());
            f.render_widget(&bar, top);

            let block = Block::default()
                .borders(Borders::ALL)
                .border_style(Style::default().fg(s.accent))
                .title(format!(" Step {} of {} ", current_step + 1, steps.len()));
            let inner = block.inner(mid);
            block.render(mid, f.buffer_mut());

            let mut y = inner.y + 1;

            let header = Paragraph::new(format!("--- {} Configuration ---", steps[current_step]))
                .style(Style::default().fg(s.accent));
            f.render_widget(
                &header,
                Rect {
                    x: inner.x + 1,
                    y,
                    width: inner.width.saturating_sub(2),
                    height: 1,
                },
            );
            y += 2;

            for (i, step) in steps.iter().enumerate() {
                if y >= inner.bottom() {
                    break;
                }
                let mark = if i == current_step {
                    "▶"
                } else if i < current_step {
                    "✓"
                } else {
                    "○"
                };
                let fg = if i == current_step {
                    s.accent
                } else if i < current_step {
                    s.success
                } else {
                    s.text_dim
                };
                let line =
                    Paragraph::new(format!(" {} {}", mark, step)).style(Style::default().fg(fg));
                f.render_widget(
                    &line,
                    Rect {
                        x: inner.x + 2,
                        y,
                        width: inner.width.saturating_sub(4),
                        height: 1,
                    },
                );
                y += 1;
            }

            y += 1;
            if current_step < 4 {
                let prompt =
                    Paragraph::new(format!("Enter {}:", steps[current_step].to_lowercase()))
                        .style(Style::default().fg(s.text_dim));
                f.render_widget(
                    &prompt,
                    Rect {
                        x: inner.x + 1,
                        y,
                        width: inner.width.saturating_sub(2),
                        height: 1,
                    },
                );
            } else {
                let done = Paragraph::new("Setup complete! Press Enter to start.")
                    .style(Style::default().fg(s.success));
                f.render_widget(
                    &done,
                    Rect {
                        x: inner.x + 1,
                        y,
                        width: inner.width.saturating_sub(2),
                        height: 1,
                    },
                );
                let dots = ThinkingDots::new()
                    .label("Finalizing")
                    .frame_index(frame_count)
                    .style(s.clone());
                f.render_widget(
                    &dots,
                    Rect {
                        x: inner.x + 1,
                        y: y + 1,
                        width: inner.width.saturating_sub(2),
                        height: 1,
                    },
                );
            }

            if !setup_log.is_empty() {
                y = inner
                    .bottom()
                    .saturating_sub(setup_log.len() as u16)
                    .saturating_sub(1);
                for log in setup_log.iter() {
                    if y >= inner.bottom() {
                        break;
                    }
                    let line = Paragraph::new(log.as_str()).style(Style::default().fg(s.text_dim));
                    f.render_widget(
                        &line,
                        Rect {
                            x: inner.x + 1,
                            y,
                            width: inner.width.saturating_sub(2),
                            height: 1,
                        },
                    );
                    y += 1;
                }
            }

            let input = BasicInput::new(&input_text)
                .placeholder("Type value...")
                .style(s.clone());
            f.render_widget(&input, bot);
        })?;

        if crossterm::event::poll(std::time::Duration::from_millis(100))? {
            if let crossterm::event::Event::Key(key) = crossterm::event::read()? {
                match key.code {
                    crossterm::event::KeyCode::Char('q') => break,
                    crossterm::event::KeyCode::Enter => {
                        if current_step < 4 {
                            if !input_text.is_empty() || current_step == 3 {
                                let val = std::mem::take(&mut input_text);
                                let log = format!(
                                    "✓ {} configured: {}",
                                    steps[current_step],
                                    if val.is_empty() { "default" } else { &val }
                                );
                                setup_log.push(log);
                                current_step += 1;
                            }
                        } else {
                            setup_log.push("✓ System ready!".to_string());
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
