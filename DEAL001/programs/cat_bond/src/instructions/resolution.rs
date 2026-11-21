//! Trigger checks and the two terminal paths: matured or triggered.
//! Ports CatBond.checkTrigger(), markMatured(), and settle().

use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

use super::shared::*;
use crate::error::CatBondError;
use crate::events::{BondMatured, Settled};
use crate::state::*;

// ── check_trigger ────────────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct CheckTrigger<'info> {
    /// Anyone may refresh the check (e.g. the "self-check" button).
    pub caller: Signer<'info>,

    #[account(mut, has_one = trigger)]
    pub bond: Account<'info, Bond>,

    pub trigger: Account<'info, Trigger>,
}

pub fn check_trigger(ctx: Context<CheckTrigger>) -> Result<bool> {
    let now = Clock::get()?.unix_timestamp;
    let caller = ctx.accounts.caller.key();
    evaluate_trigger(&mut ctx.accounts.bond, &ctx.accounts.trigger, caller, now)
}

// ── mark_matured ─────────────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct MarkMatured<'info> {
    pub company_wallet: Signer<'info>,

    #[account(
        mut,
        has_one = company_wallet @ CatBondError::NotCompanyWallet,
        has_one = trigger,
    )]
    pub bond: Account<'info, Bond>,

    pub trigger: Account<'info, Trigger>,
}

/// Human review checkpoint before principal can be withdrawn. A stale or
/// missing report blocks this, exactly as it blocks settle().
pub fn mark_matured(ctx: Context<MarkMatured>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    require_status(&ctx.accounts.bond, Status::Active)?;
    require!(now >= ctx.accounts.bond.maturity, CatBondError::NotYetMatured);

    let caller = ctx.accounts.company_wallet.key();
    let triggered = evaluate_trigger(&mut ctx.accounts.bond, &ctx.accounts.trigger, caller, now)?;
    require!(!triggered, CatBondError::TriggerAlreadyFired);

    let bond = &mut ctx.accounts.bond;
    bond.status = Status::Matured;
    emit!(BondMatured { bond: bond.key(), timestamp: now });
    Ok(())
}

// ── settle ───────────────────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct Settle<'info> {
    pub company_wallet: Signer<'info>,

    #[account(
        mut,
        has_one = company_wallet @ CatBondError::NotCompanyWallet,
        has_one = trigger,
        has_one = mint,
        has_one = vault,
    )]
    pub bond: Account<'info, Bond>,

    pub trigger: Account<'info, Trigger>,

    #[account(mut)]
    pub vault: Account<'info, TokenAccount>,

    #[account(
        mut,
        token::mint = mint,
        constraint = sponsor_token.owner == bond.sponsor @ CatBondError::WrongTokenOwner,
    )]
    pub sponsor_token: Account<'info, TokenAccount>,

    pub mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
}

/// Trigger fired: all principal goes to the sponsor. The coupon budget stays
/// in the vault, and investors can then claim their full coupon.
pub fn settle(ctx: Context<Settle>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    require_status(&ctx.accounts.bond, Status::Active)?;

    let caller = ctx.accounts.company_wallet.key();
    let triggered = evaluate_trigger(&mut ctx.accounts.bond, &ctx.accounts.trigger, caller, now)?;
    require!(triggered, CatBondError::TriggerNotFired);

    let amount = ctx.accounts.bond.total_deposited;
    {
        let bond = &mut ctx.accounts.bond;
        bond.settlement_time = now;
        bond.status = Status::Triggered;
    }

    let a = &ctx.accounts;
    transfer_from_vault(&a.token_program, &a.bond, &a.vault, &a.sponsor_token, &a.mint, amount)?;

    emit!(Settled {
        bond: a.bond.key(),
        amount_to_sponsor: amount,
        settlement_time: now,
    });
    Ok(())
}
