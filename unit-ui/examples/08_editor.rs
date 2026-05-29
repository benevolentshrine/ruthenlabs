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
        .accent(Color::Rgb(200, 140, 60))
        .text(Color::Rgb(230, 225, 220))
        .text_dim(Color::Rgb(140, 130, 120))
        .success(Color::Rgb(60, 200, 120))
        .surface(Color::Rgb(28, 26, 22))
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
    let code = "fn factorial(n: u32) -> u32 {\n    match n {\n        0 | 1 => 1,\n        _ => n * factorial(n - 1),\n    }\n}\n\nfn main() {\n    let n = 5;\n    println!(\"factorial({}) = {}\", n, factorial(n));\n}";
    let suggestion = "Add overflow check for large inputs.\nConsider using iterative approach for better performance.";

    loop {
        frame += 1;
        terminal.draw(|f| {
            let area = f.area();
            f.render_widget(Paragraph::new("").style(Style::default().bg(s.surface)), area);

            let [top, main, _bot] = Layout::vertical([
                Constraint::Length(1), Constraint::Min(3), Constraint::Length(4),
            ]).areas(area);

            let chunks = Layout::horizontal([Constraint::Percentage(60), Constraint::Percentage(40)]).split(main);
            let left = chunks[0];
            let right = if area.width > 80 { chunks[1] } else { Rect::default() };

            let bar = StatusBar::new().provider("Code Editor").model("factorial.rs")
                .connection(ConnectionStatus::Connected).started_at(started)
                .style(s.clone());
            f.render_widget(&bar, top);

            let block = Block::default().borders(Borders::ALL)
                .title(" factorial.rs ").border_style(Style::default().fg(s.text_dim));
            let inner = block.inner(left);
            f.render_widget(&block, left);
            f.render_widget(MultiLineInput::new().text(code).cursor_line(4).show_line_numbers(true).style(s.clone()), inner);

            let [tb_area, diff_area] = Layout::vertical([Constraint::Ratio(1, 2), Constraint::Ratio(1, 2)]).areas(right);
            let tb = ThinkingBlock::new().label("Code Analysis")
                .state(ThinkingState::Completed).expanded(true)
                .content(suggestion).elapsed(Duration::from_millis(frame * 30))
                .style(s.clone());
            f.render_widget(&tb, tb_area);

            let dblock = Block::default().borders(Borders::ALL)
                .title(" Changes ").border_style(Style::default().fg(s.text_dim));
            let dinner = dblock.inner(diff_area);
            f.render_widget(&dblock, diff_area);
            f.render_widget(DiffView::new().diff("@@ -1,3 +1,5 @@\n fn factorial(n: u32) -> u32 {\n-    match n {\n-        0 | 1 => 1,\n-        _ => n * factorial(n - 1),\n+    if n > 20 { return 0; }\n+    (1..=n).product()\n }").style(s.clone()), dinner);
        })?;

        if crossterm::event::poll(std::time::Duration::from_millis(80))? {
            if let crossterm::event::Event::Key(k) = crossterm::event::read()? {
                if k.code == crossterm::event::KeyCode::Char('q') {
                    break;
                }
            }
        }
    }

    disable_raw_mode()?;
    execute!(terminal.backend_mut(), LeaveAlternateScreen)?;
    Ok(())
}
