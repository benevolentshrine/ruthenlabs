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
        .accent(Color::Rgb(0, 200, 150))
        .text(Color::Rgb(200, 220, 210))
        .text_dim(Color::Rgb(90, 120, 110))
        .success(Color::Rgb(60, 220, 160))
        .surface(Color::Rgb(18, 28, 24))
        .thinking(Color::Rgb(160, 190, 80))
        .build()
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    enable_raw_mode()?;
    let mut terminal = Terminal::new(CrosstermBackend::new(stdout()))?;
    execute!(terminal.backend_mut(), EnterAlternateScreen)?;

    let s = style();
    let started = Instant::now();
    let mut output_lines: Vec<String> = vec!["Unit REPL v0.1.0 — type and press Enter. Press 'q' to quit.".to_string()];
    let mut input_text = String::from("");
    loop {
        terminal.draw(|f| {
            let area = f.area();
            let bg = Style::default().bg(s.surface);
            f.render_widget(Paragraph::new("").style(bg), area);

            let [top, mid, bot] = Layout::vertical([
                Constraint::Length(1), Constraint::Min(1), Constraint::Length(3),
            ]).areas(area);

            let bar = StatusBar::new()
                .provider("REPL").model("interactive")
                .connection(ConnectionStatus::Connected).started_at(started)
                .style(s.clone());
            f.render_widget(&bar, top);

            let block = Block::default().borders(Borders::ALL)
                .border_style(Style::default().fg(s.text_dim))
                .title(" Output ");
            let inner = block.inner(mid);
            block.render(mid, f.buffer_mut());

            let mut y = inner.y;
            for line in output_lines.iter().rev().take(inner.height as usize).rev() {
                if y >= inner.bottom() { break; }
                let text = Paragraph::new(line.as_str()).style(Style::default().fg(s.text));
                f.render_widget(&text, Rect { x: inner.x + 1, y, width: inner.width.saturating_sub(2), height: 1 });
                y += 1;
            }

            let input = BasicInput::new(&input_text).placeholder("> ").style(s.clone());
            f.render_widget(&input, bot);
        })?;

        if crossterm::event::poll(std::time::Duration::from_millis(100))? {
            if let crossterm::event::Event::Key(key) = crossterm::event::read()? {
                match key.code {
                    crossterm::event::KeyCode::Char('q') => break,
                    crossterm::event::KeyCode::Enter => {
                        if !input_text.is_empty() {
                            let line = std::mem::take(&mut input_text);
                            output_lines.push(format!("> {}", line));
                            output_lines.push(format!("  -> Echo: {}", line));
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
