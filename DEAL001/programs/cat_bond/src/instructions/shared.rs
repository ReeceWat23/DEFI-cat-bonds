//! Helpers shared by several bond instructions.

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, TransferChecked};

use crate::error::CatBondError;
use crate::events::TriggerChecked;
use crate::state::*;

/// Fails unless the bond is in `required` status.
pub fn require_status(bond: &Bond, required: Status) -> Result<()> {
    require!(bond.status == required, CatBondError::WrongStatus);
    Ok(())
}

/// Port of `CatBond.checkTrigger()`. Reads the trigger's latest report,
/// fails if none exists since this bond's commencement or if it is stale,
/// compares it to the bond's threshold, and records the result.
///
/// A stale or missing report is an error — callers (settle, mark_matured)
/// must never treat it as "not triggered."
pub fn evaluate_trigger(bond: &mut Account<Bond>, trigger: &Trigger, caller: Pubkey, now: i64) -> Result<bool> {
    let r = trigger.latest.ok_or(CatBondError::NoReports)?;
    require!(r.reported_at >= bond.active_start, CatBondError::NoReports);
    let expires = r
        .reported_at
        .checked_add(trigger.max_report_age)
        .ok_or(CatBondError::MathOverflow)?;
    require!(now <= expires, CatBondError::StaleReport);

    let triggered = r.value >= bond.threshold;
    bond.last_check = LastCheck {
        value: r.value,
        reported_at: r.reported_at,
        triggered,
        checked_at: now,
        checked_by: caller,
    };

    emit!(TriggerChecked {
        bond: bond.key(),
        value: r.value,
        reported_at: r.reported_at,
        triggered,
    });
    Ok(triggered)
}

/// Transfer from a user-owned token account (user signs).
pub fn transfer_from_user<'info>(
    token_program: &Program<'info, Token>,
    from: &Account<'info, TokenAccount>,
    to: &Account<'info, TokenAccount>,
    mint: &Account<'info, Mint>,
    authority: &Signer<'info>,
    amount: u64,
) -> Result<()> {
    if amount == 0 {
        return Ok(());
    }
    token::transfer_checked(
        CpiContext::new(
            token_program.key(),
            TransferChecked {
                from: from.to_account_info(),
                mint: mint.to_account_info(),
                to: to.to_account_info(),
                authority: authority.to_account_info(),
            },
        ),
        amount,
        mint.decimals,
    )
}

/// Transfer out of the bond vault, signed by the bond PDA.
pub fn transfer_from_vault<'info>(
    token_program: &Program<'info, Token>,
    bond: &Account<'info, Bond>,
    vault: &Account<'info, TokenAccount>,
    to: &Account<'info, TokenAccount>,
    mint: &Account<'info, Mint>,
    amount: u64,
) -> Result<()> {
    if amount == 0 {
        return Ok(());
    }
    let bump = [bond.bump];
    let seeds: &[&[u8]] = &[BOND_SEED, bond.payer.as_ref(), bond.bond_id.as_ref(), &bump];
    let signer_seeds = &[seeds];

    token::transfer_checked(
        CpiContext::new_with_signer(
            token_program.key(),
            TransferChecked {
                from: vault.to_account_info(),
                mint: mint.to_account_info(),
                to: to.to_account_info(),
                authority: bond.to_account_info(),
            },
            signer_seeds,
        ),
        amount,
        mint.decimals,
    )
}
