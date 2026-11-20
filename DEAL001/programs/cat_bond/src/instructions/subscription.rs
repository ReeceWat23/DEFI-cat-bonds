//! Investor deposits and closing the subscription window.
//! Ports CatBond.deposit() and closeSubscription().

use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

use super::shared::*;
use crate::error::CatBondError;
use crate::events::{Deposited, SubscriptionClosed};
use crate::math;
use crate::state::*;

// ── deposit ──────────────────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct Deposit<'info> {
    /// Investor signs and pays rent for their Position on first deposit.
    #[account(mut)]
    pub investor: Signer<'info>,

    #[account(mut, has_one = mint, has_one = vault)]
    pub bond: Account<'info, Bond>,

    #[account(
        init_if_needed,
        payer = investor,
        space = 8 + Position::INIT_SPACE,
        seeds = [POSITION_SEED, bond.key().as_ref(), investor.key().as_ref()],
        bump,
    )]
    pub position: Account<'info, Position>,

    #[account(mut, token::mint = mint, token::authority = investor)]
    pub investor_token: Account<'info, TokenAccount>,

    #[account(
        mut,
        token::mint = mint,
        constraint = company_token.owner == bond.company_wallet @ CatBondError::WrongTokenOwner,
    )]
    pub company_token: Account<'info, TokenAccount>,

    #[account(mut)]
    pub vault: Account<'info, TokenAccount>,

    pub mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

/// Deposit principal. `max_accepted` guards against partial fills: pass
/// `amount` for all-or-nothing, or less to cap what you'll accept.
pub fn deposit(ctx: Context<Deposit>, amount: u64, max_accepted: u64) -> Result<()> {
    let investor_key = ctx.accounts.investor.key();
    {
        let bond = &ctx.accounts.bond;
        require_status(bond, Status::Subscription)?;
        require!(
            investor_key != bond.sponsor && investor_key != bond.company_wallet,
            CatBondError::ConflictOfInterest
        );
    }

    let now = Clock::get()?.unix_timestamp;
    let bond = &ctx.accounts.bond;
    require!(now < bond.subscription_end, CatBondError::SubscriptionExpired);

    let remaining = bond.coverage_amount.saturating_sub(bond.total_deposited);
    let accepted = amount.min(remaining);
    require!(accepted >= bond.min_investment, CatBondError::BelowMinInvestment);
    require!(accepted <= max_accepted, CatBondError::ExceedsMaxAccepted);

    let fee = math::origination_fee(accepted)?;
    let a = &ctx.accounts;
    transfer_from_user(&a.token_program, &a.investor_token, &a.company_token, &a.mint, &a.investor, fee)?;
    transfer_from_user(&a.token_program, &a.investor_token, &a.vault, &a.mint, &a.investor, accepted)?;

    // First deposit: initialise the freshly created Position.
    let position = &mut ctx.accounts.position;
    let is_new = position.investor == Pubkey::default();
    if is_new {
        position.bond = ctx.accounts.bond.key();
        position.investor = investor_key;
        position.bump = ctx.bumps.position;
    }
    position.principal = position.principal.checked_add(accepted).ok_or(CatBondError::MathOverflow)?;

    let bond = &mut ctx.accounts.bond;
    if is_new {
        bond.investor_count = bond.investor_count.checked_add(1).ok_or(CatBondError::MathOverflow)?;
    }
    bond.total_deposited = bond.total_deposited.checked_add(accepted).ok_or(CatBondError::MathOverflow)?;

    emit!(Deposited {
        bond: bond.key(),
        investor: investor_key,
        accepted,
        fee_amount: fee,
        total_deposited: bond.total_deposited,
    });
    Ok(())
}

// ── close_subscription ───────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct CloseSubscription<'info> {
    /// Anyone may close once the window has passed (or it's fully subscribed).
    pub caller: Signer<'info>,

    #[account(mut, has_one = trigger, has_one = mint, has_one = vault)]
    pub bond: Account<'info, Bond>,

    pub trigger: Account<'info, Trigger>,

    #[account(mut)]
    pub vault: Account<'info, TokenAccount>,

    /// Receives the unused-coupon refund if undersubscribed.
    #[account(
        mut,
        token::mint = mint,
        constraint = sponsor_token.owner == bond.sponsor @ CatBondError::WrongTokenOwner,
    )]
    pub sponsor_token: Account<'info, TokenAccount>,

    pub mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
}

pub fn close_subscription(ctx: Context<CloseSubscription>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let a = &ctx.accounts;
    let bond = &a.bond;
    require_status(bond, Status::Subscription)?;

    let fully_subscribed = bond.total_deposited >= bond.coverage_amount;
    require!(now >= bond.subscription_end || fully_subscribed, CatBondError::SubscriptionStillOpen);

    // Early guard: commencement isn't set yet, so ask whether the latest
    // report ever posted — regardless of age — already clears the threshold.
    // No reports at all is fine here.
    if let Some(r) = a.trigger.latest {
        require!(r.value < bond.threshold, CatBondError::TriggerAlreadyFired);
    }

    let refund = math::undersubscription_refund(bond.coverage_amount, bond.total_deposited, bond.coupon_rate_bps)?;
    transfer_from_vault(&a.token_program, &a.bond, &a.vault, &a.sponsor_token, &a.mint, refund)?;

    let bond = &mut ctx.accounts.bond;
    bond.active_start = now;
    bond.maturity = now.checked_add(bond.term_duration).ok_or(CatBondError::MathOverflow)?;
    bond.status = Status::Active;

    emit!(SubscriptionClosed {
        bond: bond.key(),
        total_deposited: bond.total_deposited,
        unused_coupon_refund: refund,
    });
    Ok(())
}
