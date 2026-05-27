# Contributing

All contributions are welcome — bug reports, feature requests, documentation improvements, and pull requests.

## Quick Start

```sh
git clone https://github.com/benevolentshrine/Ruthen-Labs
cd Ruthen-Labs/unit-ui
cargo test
cargo build --examples
```

## Guidelines

- **One feature per PR.** Small, focused changes are easier to review.
- **Match the existing style.** Builder patterns, `StyleToken` theming, doc aliases on pub items.
- **Add doc-tests** to new public items. Every widget has a doc-test example.
- **Zero warnings.** Run `cargo clippy -p unit-ui` and `cargo test -p unit-ui` before opening a PR.
- **Examples belong in `examples/`.** If you add a new widget, add an example that exercises it.
- **Free tier first.** Pro-tier widget ideas are tracked separately — focus on the MIT-licensed core.

## PR Process

1. Fork the repo and create a branch from `main`.
2. Make your changes.
3. Run `cargo test -p unit-ui` and `cargo clippy -p unit-ui -- -D warnings`.
4. Open a PR with a clear description of what it does and why.

## Code of Conduct

Be respectful, constructive, and inclusive. This is a small project — let's keep it pleasant for everyone.

## License

By contributing, you agree that your contributions will be licensed under MIT OR Apache-2.0.
