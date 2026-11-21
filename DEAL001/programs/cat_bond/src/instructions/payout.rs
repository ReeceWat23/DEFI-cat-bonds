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

/// Coupon vested to this position but not yet claimed. Vesting is linear to
/// maturity (Active, Matured); once Triggered the whole coupon is vested: the
/// investor has lost their principal, and the sponsor prepaid the full-term
/// coupon for the cover. Same as CatBond.sol.
fn unclaimed_coupon(bond: &Bond, position: &Position, now: i64) -> Result<u64> {
    let elapsed = if bond.status == Status::Triggered {
        bond.term_duration
    } else {
        now.min(bond.maturity) - bond.active_start
    };
    let vested = math::vested_coupon(position.principal, bond.coupon_rate_bps, elapsed, bond.term_duration)?;
    Ok(vested.saturating_sub(position.claimed))
}

/// Claim coupon vested since the last claim. Valid while Active and after
/// Matured (vesting runs to maturity), and after Triggered (the full coupon).
///
/// Matured is allowed so coupon still unclaimed at mark_matured() is never
/// stranded; withdraw_principal() also sweeps it. CatBond.sol had the same
/// stranding bug and has the same fix.
pub fn claim_coupon(ctx: Context<InvestorPayout>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let a = &ctx.accounts;
    require!(
        matches!(a.bond.status, Status::Active | Status::Matured | Status::Triggered),
        CatBondError::WrongStatus
    );
    require!(a.position.principal > 0, CatBondError::NotInvestor);

    let claimable = unclaimed_coupon(&a.bond, &a.position, now)?;
    require!(claimable > 0, CatBondError::NothingToClaim);

    // Effects before interaction.
    let position = &mut ctx.accounts.position;
    position.claimed = position.claimed.checked_add(claimable).ok_or(CatBondError::MathOverflow)?;

    let a = &ctx.accounts;
    transfer_from_vault(&a.token_program, &a.bond, &a.vault, &a.investor_token, &a.mint, claimable)?;

    emit!(CouponClaimed { bond: a.bond.key(), investor: a.investor.key(), amount: claimable });
    Ok(())
}

/// Withdraw full principal plus any coupon not yet claimed, in one transfer.
/// Only after mark_matured().
pub fn withdraw_principal(ctx: Context<InvestorPayout>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    require_status(&ctx.accounts.bond, Status::Matured)?;
    let principal = ctx.accounts.position.principal;
    require!(principal > 0, CatBondError::NotInvestor);
    require!(!ctx.accounts.position.withdrawn, CatBondError::AlreadyWithdrawn);

    let coupon = unclaimed_coupon(&ctx.accounts.bond, &ctx.accounts.position, now)?;

    // Effects before interaction.
    let position = &mut ctx.accounts.position;
    position.withdrawn = true;
    position.claimed = position.claimed.checked_add(coupon).ok_or(CatBondError::MathOverflow)?;
    let total = principal.checked_add(coupon).ok_or(CatBondError::MathOverflow)?;

    let a = &ctx.accounts;
    transfer_from_vault(&a.token_program, &a.bond, &a.vault, &a.investor_token, &a.mint, total)?;

    if coupon > 0 {
        emit!(CouponClaimed { bond: a.bond.key(), investor: a.investor.key(), amount: coupon });
    }
    emit!(PrincipalWithdrawn { bond: a.bond.key(), investor: a.investor.key(), amount: principal });
    Ok(())
}
