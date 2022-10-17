# Solana Escrow

Escrow program for safe exchange of tokens on Solana, created with Anchor.

## Prerequisites

- Install Rust: https://rustup.rs/
- Install Solana: https://docs.solana.com/cli/install-solana-cli-tools#use-solanas-install-tool
- Install Anchor: `cargo install --git https://github.com/project-serum/anchor anchor-cli --locked`
- Install Yarn: `apt install yarn` using apt on Linux or `npm install -g yarn` using npm

## Build, Deploy and Test the Program

- Build: `anchor build`
- Deploy: `anchor deploy`

After initial deployment, make sure to update the program ID in `lib.rs` and `Anchor.toml` files.

Then, run `anchor test` to test the program.
