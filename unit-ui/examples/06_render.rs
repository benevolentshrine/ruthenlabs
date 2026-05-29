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
        .accent(Color::Rgb(80, 180, 220))
        .text(Color::Rgb(230, 230, 240))
        .text_dim(Color::Rgb(110, 140, 160))
        .success(Color::Rgb(60, 200, 120))
        .surface(Color::Rgb(20, 26, 30))
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
    let md = "# Unit-UI Toolkit\n\nA **Rust** library for building AI agent CLIs.\n\n## Features\n\n- `StreamingText` — token-by-token rendering\n- `ThinkingBlock` — collapsible reasoning\n- `MarkdownBlock` — render formatted text\n\n> Built on [Ratatui](https://ratatui.rs)\n\n### Inline code\n\nUse `unit_ui::prelude::*` to get started.\n\n- Fast\n- Composable\n- Open source";

    loop {
        frame += 1;
        terminal.draw(|f| {
            let area = f.area();
            f.render_widget(
                Paragraph::new("").style(Style::default().bg(s.surface)),
                area,
            );

            let [top, main, bot] = Layout::vertical([
                Constraint::Length(1),
                Constraint::Min(3),
                Constraint::Length(3),
            ])
            .areas(area);

            let chunks =
                Layout::horizontal([Constraint::Percentage(50), Constraint::Percentage(50)])
                    .split(main);
            let md_area = chunks[0];
            let stream_area = if area.width > 80 {
                chunks[1]
            } else {
                Rect::default()
            };

            let bar = StatusBar::new()
                .provider("Markdown Renderer")
                .connection(ConnectionStatus::Connected)
                .started_at(started)
                .style(s.clone());
            f.render_widget(&bar, top);

            let block = Block::default()
                .borders(Borders::ALL)
                .title(" Rendered ")
                .border_style(Style::default().fg(s.text_dim));
            let inner = block.inner(md_area);
            f.render_widget(&block, md_area);
            f.render_widget(MarkdownBlock::new().content(md).style(s.clone()), inner);

            let sblock = Block::default()
                .borders(Borders::ALL)
                .title(" Streaming ")
                .border_style(Style::default().fg(s.text_dim));
            let sinner = sblock.inner(stream_area);
            f.render_widget(&sblock, stream_area);
            let visible = (frame as usize) % md.len().max(1);
            f.render_widget(
                StreamingText::new(&md[..visible])
                    .typing_speed(100)
                    .style(s.clone()),
                sinner,
            );

            f.render_widget(
                BasicInput::new(&input_text)
                    .placeholder("Type markdown or press Enter...")
                    .style(s.clone()),
                bot,
            );
        })?;

        if crossterm::event::poll(std::time::Duration::from_millis(80))? {
            if let crossterm::event::Event::Key(key) = crossterm::event::read()? {
                match key.code {
                    crossterm::event::KeyCode::Char('q') => break,
                    crossterm::event::KeyCode::Char(c) => input_text.push(c),
                    crossterm::event::KeyCode::Enter => input_text.clear(),
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
