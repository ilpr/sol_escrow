use anchor_lang::prelude::*;
use anchor_spl::token::{
    self,
    Token,
    SetAuthority,
    CloseAccount,
    TokenAccount,
    Transfer,
    Mint
};
use spl_token::instruction::AuthorityType;
use bytemuck;

declare_id!("7D6qfqnKDM2ktD634e8HMiAbDBMZG8cWARKRbmL8MxLW");

const SEEDS: &'static [u8] = b"sol_escrow";

#[program]
pub mod sol_escrow {

    use super::*;

    pub fn init_escrow(
        ctx: Context<InitEscrow>,
        alice_amount_to_receive: u64,
        bob_amount_to_receive: u64,
        bump: u8
    ) -> Result<()> {

        // Populate escrow account.
        ctx.accounts.escrow_account.alice_key = *ctx.accounts.alice_account.key;
        ctx.accounts.escrow_account.mint_x_vault = *ctx.accounts.mint_x_vault.to_account_info().key;
        ctx.accounts.escrow_account.mint_y = *ctx.accounts.mint_y.to_account_info().key;
        ctx.accounts.escrow_account.alice_amount_to_receive = alice_amount_to_receive;
        ctx.accounts.escrow_account.bob_amount_to_receive = bob_amount_to_receive;
        ctx.accounts.escrow_account.bump = bump;

        // Transfer token X from Alice to vault account.
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.alice_token_x_account.to_account_info().clone(),
                    to: ctx.accounts.mint_x_vault.to_account_info().clone(),
                    authority: ctx.accounts.alice_account.to_account_info().clone()
                }
            ),
            bob_amount_to_receive
        )?;

        // Transfer vault account authority to PDA.
        token::set_authority(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                SetAuthority {
                    current_authority: ctx.accounts.alice_account.to_account_info(),
                    account_or_mint: ctx.accounts.mint_x_vault.to_account_info()
                }
            ),
            AuthorityType::AccountOwner,
            Some(ctx.accounts.vault_authority.key())
        )?;

        Ok(())
    }

    pub fn process_exchange(ctx: Context<Exchange>) -> Result<()> {

        let signer_seeds = &[&[SEEDS, bytemuck::bytes_of(&ctx.accounts.escrow_account.bump)][..]];

        // Transfer token Y to Alice.
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.bob_token_y_account.to_account_info().clone(),
                    to: ctx.accounts.alice_token_y_account.to_account_info().clone(),
                    authority: ctx.accounts.bob_account.to_account_info().clone()
                }
            ),
            ctx.accounts.escrow_account.alice_amount_to_receive,
        )?;
    
        // Transfer token X to Bob.
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                from: ctx.accounts.mint_x_vault.to_account_info().clone(),
                to: ctx.accounts.bob_token_x_account.to_account_info().clone(),
                authority: ctx.accounts.vault_authority.clone()
                },
                signer_seeds
            ),
            ctx.accounts.escrow_account.bob_amount_to_receive,
        )?;
    
        // Close the vault account.
        token::close_account(CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                CloseAccount {
                    account: ctx.accounts.mint_x_vault.to_account_info().clone(),
                    destination: ctx.accounts.alice_account.clone(),
                    authority: ctx.accounts.vault_authority.clone()
                }
            ).with_signer(signer_seeds)
        )?;
    
        Ok(())
    }

    pub fn cancel(ctx: Context<Cancel>) -> Result<()> {

        let signer_seeds = &[&[SEEDS, bytemuck::bytes_of(&ctx.accounts.escrow_account.bump)][..]];

        // Send token X back to Alice.
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                from: ctx.accounts.mint_x_vault.to_account_info().clone(),
                to: ctx.accounts.alice_token_x_account.to_account_info().clone(),
                authority: ctx.accounts.vault_authority.clone()
                },
                signer_seeds
            ),
            ctx.accounts.escrow_account.bob_amount_to_receive,
        )?;
    
        // Close the cault account.
        token::close_account(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                CloseAccount {
                    account: ctx.accounts.mint_x_vault.to_account_info().clone(),
                    destination: ctx.accounts.alice_account.to_account_info().clone(),
                    authority: ctx.accounts.vault_authority.clone()
                }
            )
            .with_signer(signer_seeds)
        )?;
    
        Ok(())
    }
}

    #[derive(Accounts)]
    #[instruction(
        alice_amount_to_receive: u64,
        bob_amount_to_receive: u64,
        bump: u8
    )]
    pub struct InitEscrow<'info> {
        /// CHECK: This is not dangerous because we don't read or write from this account
        #[account(mut)]
        pub alice_account: Signer<'info>,
        #[account(
            mut,
            constraint = alice_token_x_account.amount >= bob_amount_to_receive
            @ EscrowError::NotEnoughTokensAlice
        )]
        pub alice_token_x_account: Account<'info, TokenAccount>,
        pub mint_x: Account<'info, Mint>,
        pub mint_y: Account<'info, Mint>,
        #[account(
            init,
            payer = alice_account,
            token::authority = alice_account,
            token::mint = mint_x
        )]
        pub mint_x_vault: Account<'info, TokenAccount>,
        /// CHECK: This is not dangerous because we don't read or write from this account
        #[account(
            seeds = [SEEDS],
            bump = bump
        )]
        pub vault_authority: AccountInfo<'info>,
        #[account(
            init,
            payer = alice_account,
            space = Escrow::LEN
        )]
        pub escrow_account: Account<'info, Escrow>,
        pub rent: Sysvar<'info, Rent>,
        /// CHECK: This is not dangerous because we don't read or write from this account
        pub token_program: Program<'info, Token>,
        pub system_program: Program<'info, System>
    }

    #[derive(Accounts)]
    pub struct Exchange<'info> {
        /// CHECK: This is not dangerous because we don't read or write from this account
        #[account(mut)]
        pub bob_account: Signer<'info>,
        #[account(
            mut,
            token::mint = escrow_account.mint_y,
            constraint = bob_token_y_account.amount >= escrow_account.alice_amount_to_receive
            @EscrowError::NotEnoughTokensBob
        )]
        pub bob_token_y_account: Account<'info, TokenAccount>,
        #[account(mut)]
        pub bob_token_x_account: Account<'info, TokenAccount>,
        #[account( mut)]
        pub mint_x_vault: Account<'info, TokenAccount>,
        /// CHECK: This is not dangerous because we don't read or write from this account
        #[account(
            seeds = [SEEDS],
            bump = escrow_account.bump
        )]
        pub vault_authority: AccountInfo<'info>,
        /// CHECK: This is not dangerous because we don't read or write from this account
        #[account(mut)]
        pub alice_account: AccountInfo<'info>,
        /// CHECK: This is not dangerous because we don't read or write from this account
        #[account(mut)]
        pub alice_token_y_account: Account<'info, TokenAccount>,
        #[account(
            mut,
            owner = crate::ID,
            constraint = escrow_account.alice_key == *alice_account.key
            @ EscrowError::IncorrectAccounts,
            constraint = escrow_account.mint_x_vault == *mint_x_vault.to_account_info().key
            @ EscrowError::IncorrectAccounts,
            close = alice_account
        )]
        pub escrow_account: Account<'info, Escrow>,
        /// CHECK: This is not dangerous because we don't read or write from this account
        pub token_program: Program<'info, Token>
    }
    
    #[derive(Accounts)]
    pub struct Cancel<'info> {
        /// CHECK: This is not dangerous because we don't read or write from this account
        #[account(mut)]
        pub alice_account: Signer<'info>,
        #[account(mut)]
        pub alice_token_x_account: Account<'info, TokenAccount>,
        #[account(mut)]
        pub mint_x_vault: Account<'info, TokenAccount>,
        /// CHECK: This is not dangerous because we don't read or write from this account
        #[account(
            seeds = [SEEDS],
            bump = escrow_account.bump
        )]
        pub vault_authority: AccountInfo<'info>,
        /// CHECK: This is not dangerous because we don't read or write from this account
        #[account(
            mut,
            owner = crate::ID,
            constraint = escrow_account.alice_key == *alice_account.key
            @ EscrowError::IncorrectAccounts,
            constraint = escrow_account.mint_x_vault == *mint_x_vault.to_account_info().key
            @ EscrowError::IncorrectAccounts,
            close = alice_account
        )]
        pub escrow_account: Account<'info, Escrow>,
        /// CHECK: This is not dangerous because we don't read or write from this account
        pub token_program: Program<'info, Token>
    }

    #[account]
    pub struct Escrow {
        pub alice_key: Pubkey,
        pub mint_x_vault: Pubkey,
        pub mint_y: Pubkey,
        pub alice_amount_to_receive: u64,
        pub bob_amount_to_receive: u64,
        pub bump: u8
    }

    impl Escrow {
        const LEN: usize = 8 + 32 + 32 + 32 + 8 + 8 + 1;
    }

    #[error_code]
    pub enum EscrowError {
        #[msg("Accounts dont' match the accounts in escrow state account")]
        IncorrectAccounts,
        #[msg("Not enough tokens in Alice's account to cover the expected amount")]
        NotEnoughTokensAlice,
        #[msg("Not enough tokens in Bob's account to cover the expected amount")]
        NotEnoughTokensBob
    }
