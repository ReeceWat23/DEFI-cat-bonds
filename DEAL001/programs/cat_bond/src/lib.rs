//! RHODEX catastrophe bond — Solana port of DEAL 000 (CatBond.sol + TriggerBase.sol).
//!
//! Lifecycle:  Funding → Subscription → Active → Matured | Triggered
//!
//!   create_bond          sponsor posts the deal (EVM constructor)
//!   fund_coupon_budget   sponsor funds coupon budget + 0.5% fee
//!   deposit              investors deposit principal + 0.5% fee
//!   close_subscription   anyone, after the window / when full
//!   claim_coupon         investors, pro-rata per second
//!   mark_matured         company wallet, after maturity, trigger not fired
//!   withdraw_principal   investors, after Matured
//!   settle               company wallet, trigger fired → principal to sponsor
//!   check_trigger        anyone, refreshes bond.last_check
//!   set_verified         company wallet, any status
//!
//! Trigger (append-only report log):
//!   create_trigger, set_reporter, post_report

use anchor_lang::prelude::*;

pub mod error;
pub mod events;
pub mod instructions;
pub mod math;
pub mod state;

use instructions::*;

declare_id!("3UQzswu1vGu8DoGAttWtWRm3zFvCSvreoG7HDohTqxAj");

#[program]
pub mod cat_bond {
    use super::*;

    // ── Trigger ──────────────────────────────────────────────────────────────

    pub fn create_trigger(ctx: Context<CreateTrigger>, args: CreateTriggerArgs) -> Result<()> {
        instructions::trigger::create_trigger(ctx, args)
    }

    pub fn set_reporter(ctx: Context<SetReporter>, reporter: Pubkey) -> Result<()> {
        instructions::trigger::set_reporter(ctx, reporter)
    }

    pub fn post_report(ctx: Context<PostReport>, value: u128, monitor_ref: [u8; 32]) -> Result<()> {
        instructions::trigger::post_report(ctx, value, monitor_ref)
    }

    // ── Bond lifecycle ───────────────────────────────────────────────────────

    pub fn create_bond(ctx: Context<CreateBond>, args: CreateBondArgs) -> Result<()> {
        instructions::setup::create_bond(ctx, args)
    }

    pub fn fund_coupon_budget(ctx: Context<FundCouponBudget>) -> Result<()> {
        instructions::setup::fund_coupon_budget(ctx)
    }

    pub fn deposit(ctx: Context<Deposit>, amount: u64, max_accepted: u64) -> Result<()> {
        instructions::subscription::deposit(ctx, amount, max_accepted)
    }

    pub fn close_subscription(ctx: Context<CloseSubscription>) -> Result<()> {
        instructions::subscription::close_subscription(ctx)
    }

    pub fn claim_coupon(ctx: Context<InvestorPayout>) -> Result<()> {
        instructions::payout::claim_coupon(ctx)
    }

    pub fn mark_matured(ctx: Context<MarkMatured>) -> Result<()> {
        instructions::resolution::mark_matured(ctx)
    }

    pub fn withdraw_principal(ctx: Context<InvestorPayout>) -> Result<()> {
        instructions::payout::withdraw_principal(ctx)
    }

    pub fn settle(ctx: Context<Settle>) -> Result<()> {
        instructions::resolution::settle(ctx)
    }

    pub fn check_trigger(ctx: Context<CheckTrigger>) -> Result<bool> {
        instructions::resolution::check_trigger(ctx)
    }

    pub fn set_verified(ctx: Context<SetVerified>, verified: bool) -> Result<()> {
        instructions::setup::set_verified(ctx, verified)
    }
}
