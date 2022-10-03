use anchor_lang::prelude::*;
use anchor_spl::token::{
    self,
    CloseAccount,
    TokenAccount,
    Transfer,
    Mint
};
use bytemuck;

declare_id!("7D6qfqnKDM2ktD634e8HMiAbDBMZG8cWARKRbmL8MxLW");

const ESCROW_SEED: &[u8] = b"escrow";

#[program]
pub mod sol_escrow {
    use super::*;

    pub fn init_escrow(
        ctx: Context<InitEscrow>,
        alice_amount_to_receive: u64,
        bob_amount_to_receive: u64,
        _bump: u8
    ) -> Result<()> {

        // Populate escrow account.
        ctx.accounts.escrow_account.alice_key = *ctx.accounts.alice_account.key;
        ctx.accounts.escrow_account.alice_token_x_account = *ctx.accounts.alice_token_x_account.to_account_info().key;
        ctx.accounts.escrow_account.alice_token_y_account = *ctx.accounts.alice_token_y_account.to_account_info().key;
        ctx.accounts.escrow_account.alice_amount_to_receive = alice_amount_to_receive;
        ctx.accounts.escrow_account.bob_amount_to_receive = bob_amount_to_receive;
    
        // Transfer token X from Alice to temporary token X account.
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.clone(),
                Transfer {
                    from: ctx.accounts.alice_token_x_account.to_account_info().clone(),
                    to: ctx.accounts.temp_token_x_account.to_account_info().clone(),
                    authority: ctx.accounts.alice_account.to_account_info().clone()
                }
            ),
            ctx.accounts.escrow_account.bob_amount_to_receive
        )?;
    
        Ok(())
    }

    pub fn process_exchange(ctx: Context<Exchange>, bump: u8) -> Result<()> {

        // Transfer token Y to Alice.
        msg!("Transferring token Y from Bob to Alice...");
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.clone(),
                Transfer {
                    from: ctx.accounts.bob_token_y_account.to_account_info().clone(),
                    to: ctx.accounts.alice_token_y_account.to_account_info().clone(),
                    authority: ctx.accounts.bob_account.to_account_info().clone()
                }
            ),
            ctx.accounts.escrow_account.alice_amount_to_receive,
        )?;
    
        // Transfer token X to Bob.
        
        let signer_seeds = &[&[ESCROW_SEED, bytemuck::bytes_of(&bump)][..]];
    
        msg!("Transferring token X from Alice to Bob...");
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.clone(),
                Transfer {
                from: ctx.accounts.temp_token_x_account.to_account_info().clone(),
                to: ctx.accounts.bob_token_x_account.to_account_info().clone(),
                authority: ctx.accounts.pda.clone()
                },
                signer_seeds
            ),
            ctx.accounts.escrow_account.bob_amount_to_receive,
        )?;
    
        // close the temporary token account.
        msg!("Closing temporary token account...");
        token::close_account(CpiContext::new(
                ctx.accounts.token_program.clone(),
                CloseAccount {
                    account: ctx.accounts.temp_token_x_account.to_account_info().clone(),
                    destination: ctx.accounts.alice_account.clone(),
                    authority: ctx.accounts.pda.clone(),
                }
            ).with_signer(signer_seeds)
        )?;
    
        Ok(())
    }

    pub fn cancel(ctx: Context<Cancel>, bump: u8) -> Result<()> {

        let signer_seeds = &[&[ESCROW_SEED, bytemuck::bytes_of(&bump)][..]];

        // Send token X back to Alice.
        msg!("sending x tokens back...");
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.clone(),
                Transfer {
                from: ctx.accounts.temp_token_x_account.to_account_info().clone(),
                to: ctx.accounts.alice_token_x_account.to_account_info().clone(),
                authority: ctx.accounts.pda.clone()
                },
                signer_seeds
            ),
            ctx.accounts.escrow_account.bob_amount_to_receive,
        )?;
    
        // close the temporary token account.
        msg!("closing account...");
        token::close_account(
            CpiContext::new(
                ctx.accounts.token_program.clone(),
                CloseAccount {
                    account: ctx.accounts.temp_token_x_account.to_account_info().clone(),
                    destination: ctx.accounts.alice_account.to_account_info().clone(),
                    authority: ctx.accounts.pda.clone(),
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
        #[account(
            init,
            payer = alice_account,
            token::authority = pda,
            token::mint = mint_x
        )]
        pub temp_token_x_account: Account<'info, TokenAccount>,
        #[account(
            seeds = [ESCROW_SEED],
            bump = bump
        )]
        /// CHECK: This is not dangerous because we don't read or write from this account
        pub pda: AccountInfo<'info>,
        pub alice_token_y_account: Account<'info, TokenAccount>,
        #[account(
            init,
            payer = alice_account,
            space = Escrow::LEN
        )]
        pub escrow_account: Account<'info, Escrow>,
        pub mint_x: Account<'info, Mint>,
        pub rent: Sysvar<'info, Rent>,
        /// CHECK: This is not dangerous because we don't read or write from this account
        pub token_program: AccountInfo<'info>,
        pub system_program: Program<'info, System>
    }

    #[derive(Accounts)]
    #[instruction(bump: u8)]
    pub struct Exchange<'info> {
        /// CHECK: This is not dangerous because we don't read or write from this account
        #[account(mut)]
        pub bob_account: Signer<'info>,
        #[account(
            mut,
            constraint = bob_token_y_account.amount >= escrow_account.alice_amount_to_receive
            @ EscrowError::NotEnoughTokensBob,
        )]
        pub bob_token_y_account: Account<'info, TokenAccount>,
        #[account(mut)]
        pub bob_token_x_account: Account<'info, TokenAccount>,
        #[account(
            mut,
            token::authority = pda
        )]
        pub temp_token_x_account: Account<'info, TokenAccount>,
        #[account(
            seeds = [ESCROW_SEED],
            bump = bump
        )]
        /// CHECK: This is not dangerous because we don't read or write from this account
        pub pda: AccountInfo<'info>,
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
            constraint = escrow_account.alice_token_y_account == *alice_token_y_account.to_account_info().key
            @ EscrowError::IncorrectAccounts,
            close = alice_account
        )]
        pub escrow_account: Account<'info, Escrow>,
        /// CHECK: This is not dangerous because we don't read or write from this account
        pub token_program: AccountInfo<'info>,
        pub system_program: Program<'info, System>
    }
    
    #[derive(Accounts)]
    #[instruction(bump: u8)]
    pub struct Cancel<'info> {
        #[account(mut)]
        /// CHECK: This is not dangerous because we don't read or write from this account
        pub alice_account: Signer<'info>,
        #[account(mut)]
        pub alice_token_x_account: Account<'info, TokenAccount>,
        #[account(
            mut,
            token::authority = pda
        )]
        pub temp_token_x_account: Account<'info, TokenAccount>,
        #[account(
            seeds = [ESCROW_SEED],
            bump = bump
        )]
        /// CHECK: This is not dangerous because we don't read or write from this account
        pub pda: AccountInfo<'info>,
        /// CHECK: This is not dangerous because we don't read or write from this account
        #[account(
            mut,
            owner = crate::ID,
            constraint = escrow_account.alice_key == *alice_account.key
            @ EscrowError::IncorrectAccounts,
            constraint = escrow_account.alice_token_x_account == *alice_token_x_account.to_account_info().key
            @ EscrowError::IncorrectAccounts,
            close = alice_account
        )]
        pub escrow_account: Account<'info, Escrow>,
        /// CHECK: This is not dangerous because we don't read or write from this account
        pub token_program: AccountInfo<'info>
    }

    #[account]
    pub struct Escrow {
        pub alice_key: Pubkey,
        pub alice_token_x_account: Pubkey,
        pub alice_token_y_account: Pubkey,
        pub alice_amount_to_receive: u64,
        pub bob_amount_to_receive: u64
    }

    impl Escrow {
        pub const LEN: usize = 8 + 32 + 32 + 32 + 8 + 8;
    }

    #[error_code]
    pub enum EscrowError {
        #[msg("Accounts dont' match with accounts in escrow state account")]
        IncorrectAccounts,
        #[msg("Not enough tokens in Alice's account to cover the expected amount")]
        NotEnoughTokensAlice,
        #[msg("Not enough tokens in Bob's account to cover the expected amount")]
        NotEnoughTokensBob
    }
