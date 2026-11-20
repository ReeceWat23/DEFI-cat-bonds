//! Investor payouts. Ports CatBond.claimCoupon() and withdrawPrincipal().

use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

use super::shared::*;
use crate::error::CatBondError;
use crate::events::{CouponClaimed, PrincipalWithdrawn};
use crate::math;
use crate::state::*;

#[derive(Accounts)]
pub struct InvestorPayout<'info> {
    pub investor: Signer<'info>,

    #[account(has_one = mint, has_one = vault)]
    pub bond: Account<'info, Bond>,

    #[account(
        mut,
        seeds = [POSITION_SEED, bond.key().as_ref(), investor.key().as_ref()],
        bump = position.bump,
        has_one = bond,
        has_one = investor @ CatBondError::NotInvestor,
    )]
    pub position: Account<'info, Position>,

    #[account(mut)]
    pub vault: Account<'info, TokenAccount>,

    #[account(mut, token::mint = mint, token::authority = investor)]
    pub investor_token: Account<'info, TokenAccount>,

    pub mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
}

/// Claim coupon vested since the last claim. Valid while Active (vesting to
/// maturity) and after Triggered (vesting stops at settlement_time).
pub fn claim_coupon(ctx: Context<InvestorPayout>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let a = &ctx.accounts;
    let bond = &a.bond;
    require!(
        bond.status == Status::Active || bond.status == Status::Triggered,
        CatBondError::WrongStatus
    );
    require!(a.position.principal > 0, CatBondError::NotInvestor);

    let vesting_end = if bond.status == Status::Triggered { bond.settlement_time } else { bond.maturity };
    let elapsed = now.min(vesting_end) - bond.active_start;
    let vested = math::vested_coupon(a.position.principal, bond.coupon_rate_bps, elapsed, bond.term_duration)?;
    let claimable = vested.saturating_sub(a.position.claimed);
    require!(claimable > 0, CatBondError::NothingToClaim);

    // Effects before interaction.
    let position = &mut ctx.accounts.position;
    position.claimed = position.claimed.checked_add(claimable).ok_or(CatBondError::MathOverflow)?;

    let a = &ctx.accounts;
    transfer_from_vault(&a.token_program, &a.bond, &a.vault, &a.investor_token, &a.mint, claimable)?;

    emit!(CouponClaimed { bond: a.bond.key(), investor: a.investor.key(), amount: claimable });
    Ok(())
}

/// Withdraw full principal. Only after mark_matured().
pub fn withdraw_principal(ctx: Context<InvestorPayout>) -> Result<()> {
    require_status(&ctx.accounts.bond, Status::Matured)?;
    let principal = ctx.accounts.position.principal;
    require!(principal > 0, CatBondError::NotInvestor);
    require!(!ctx.accounts.position.withdrawn, CatBondError::AlreadyWithdrawn);

    ctx.accounts.position.withdrawn = true;

    let a = &ctx.accounts;
    transfer_from_vault(&a.token_program, &a.bond, &a.vault, &a.investor_token, &a.mint, principal)?;

    emit!(PrincipalWithdrawn { bond: a.bond.key(), investor: a.investor.key(), amount: principal });
    Ok(())
}
