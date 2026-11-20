//! Trigger instructions — port of TriggerBase.sol.

use anchor_lang::prelude::*;

use crate::error::CatBondError;
use crate::events::{ReportPosted, ReporterSet, TriggerCreated};
use crate::state::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct CreateTriggerArgs {
    pub trigger_id: u64,
    pub reporter: Pubkey,
    pub product_id: String,
    pub version: u64,
    pub value_path: String,
    pub units: String,
    pub max_report_age: i64,
    pub endpoint_hash: [u8; 32],
}

// ── create_trigger ───────────────────────────────────────────────────────────

#[derive(Accounts)]
#[instruction(args: CreateTriggerArgs)]
pub struct CreateTrigger<'info> {
    /// Owner of the trigger (may rotate the reporter). Pays rent.
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        init,
        payer = owner,
        space = 8 + Trigger::INIT_SPACE,
        seeds = [TRIGGER_SEED, owner.key().as_ref(), &args.trigger_id.to_le_bytes()],
        bump,
    )]
    pub trigger: Account<'info, Trigger>,

    pub system_program: Program<'info, System>,
}

pub fn create_trigger(ctx: Context<CreateTrigger>, args: CreateTriggerArgs) -> Result<()> {
    require_keys_neq!(args.reporter, Pubkey::default(), CatBondError::ZeroAddress);
    require!(args.product_id.len() <= MAX_PRODUCT_ID_LEN, CatBondError::InputTooLong);
    require!(args.value_path.len() <= MAX_VALUE_PATH_LEN, CatBondError::InputTooLong);
    require!(args.units.len() <= MAX_UNITS_LEN, CatBondError::InputTooLong);
    require!(args.max_report_age > 0, CatBondError::InvalidParams);

    let trigger = &mut ctx.accounts.trigger;
    trigger.set_inner(Trigger {
        owner: ctx.accounts.owner.key(),
        reporter: args.reporter,
        trigger_id: args.trigger_id,
        product_id: args.product_id,
        version: args.version,
        value_path: args.value_path,
        units: args.units,
        max_report_age: args.max_report_age,
        endpoint_hash: args.endpoint_hash,
        report_count: 0,
        latest: None,
        bump: ctx.bumps.trigger,
    });

    emit!(TriggerCreated {
        trigger: trigger.key(),
        owner: trigger.owner,
        reporter: trigger.reporter,
        product_id: trigger.product_id.clone(),
        version: trigger.version,
    });
    Ok(())
}

// ── set_reporter ─────────────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct SetReporter<'info> {
    pub owner: Signer<'info>,

    #[account(mut, has_one = owner @ CatBondError::NotOwner)]
    pub trigger: Account<'info, Trigger>,
}

/// Change who may post reports. Lets an oracle network be swapped in later.
pub fn set_reporter(ctx: Context<SetReporter>, reporter: Pubkey) -> Result<()> {
    require_keys_neq!(reporter, Pubkey::default(), CatBondError::ZeroAddress);
    let trigger = &mut ctx.accounts.trigger;
    trigger.reporter = reporter;
    emit!(ReporterSet { trigger: trigger.key(), reporter });
    Ok(())
}

// ── post_report ──────────────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct PostReport<'info> {
    /// Reporter signs and pays rent for the new Report entry.
    #[account(mut)]
    pub reporter: Signer<'info>,

    #[account(mut, has_one = reporter @ CatBondError::NotReporter)]
    pub trigger: Account<'info, Trigger>,

    #[account(
        init,
        payer = reporter,
        space = 8 + Report::INIT_SPACE,
        seeds = [REPORT_SEED, trigger.key().as_ref(), &trigger.report_count.to_le_bytes()],
        bump,
    )]
    pub report: Account<'info, Report>,

    pub system_program: Program<'info, System>,
}

/// Append a confirmed value from the off-chain monitor. Nothing is
/// overwritten in history; `trigger.latest` is a convenience copy.
pub fn post_report(ctx: Context<PostReport>, value: u128, monitor_ref: [u8; 32]) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let trigger = &mut ctx.accounts.trigger;
    let index = trigger.report_count;

    let data = ReportData {
        value,
        reported_at: now,
        reporter: ctx.accounts.reporter.key(),
        monitor_ref,
    };

    ctx.accounts.report.set_inner(Report {
        trigger: trigger.key(),
        index,
        data,
        bump: ctx.bumps.report,
    });

    trigger.latest = Some(data);
    trigger.report_count = index.checked_add(1).ok_or(CatBondError::MathOverflow)?;

    emit!(ReportPosted {
        trigger: trigger.key(),
        index,
        value,
        reported_at: now,
        reporter: data.reporter,
        monitor_ref,
    });
    Ok(())
}
