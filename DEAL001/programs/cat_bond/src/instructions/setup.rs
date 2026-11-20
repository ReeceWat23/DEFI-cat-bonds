//! Bond creation, sponsor funding, and the verification stamp.
//! Ports CatBond's constructor, fundCouponBudget(), and setVerified().

use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

use super::shared::*;
use crate::error::CatBondError;
use crate::events::{BondCreated, SellerVerified, SponsorFunded};
use crate::math;
use crate::state::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct CreateBondArgs {
    /// PDA seed; the UI uses sha256(dealId).
    pub bond_id: [u8; 32],
    pub company_wallet: Pubkey,
    pub threshold: u128,
    pub coupon_rate_bps: u16,
    pub coverage_amount: u64,
    pub min_investment: u64,
    pub subscription_duration: i64,
    pub term_duration: i64,
    pub seller_name: String,
    pub deal_id: String,
    pub exposure: Vec<ExposureRegion>,
}

// ── create_bond (constructor) ────────────────────────────────────────────────

#[derive(Accounts)]
#[instruction(args: CreateBondArgs)]
pub struct CreateBond<'info> {
    /// The sponsor posts the deal and pays rent for its accounts.
    #[account(mut)]
    pub sponsor: Signer<'info>,

    /// Typed as `Account<Trigger>`, so Anchor checks it is owned by this
    /// program and carries the Trigger discriminator. That replaces the
    /// EVM ZeroTrigger / InvalidTrigger / reportCount() probe checks.
    pub trigger: Account<'info, Trigger>,

    /// Collateral mint (USDC on mainnet, RDX test token locally).
    pub mint: Account<'info, Mint>,

    #[account(
        init,
        payer = sponsor,
        space = 8 + Bond::INIT_SPACE,
        seeds = [BOND_SEED, sponsor.key().as_ref(), args.bond_id.as_ref()],
        bump,
    )]
    pub bond: Account<'info, Bond>,

    /// Holds coupon budget + principal. Owned by the bond PDA.
    #[account(
        init,
        payer = sponsor,
        seeds = [VAULT_SEED, bond.key().as_ref()],
        bump,
        token::mint = mint,
        token::authority = bond,
    )]
    pub vault: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn create_bond(ctx: Context<CreateBond>, args: CreateBondArgs) -> Result<()> {
    // Strings / vecs must fit the space reserved for them.
    require!(args.seller_name.len() <= MAX_SELLER_NAME_LEN, CatBondError::InputTooLong);
    require!(args.deal_id.len() <= MAX_DEAL_ID_LEN, CatBondError::InputTooLong);
    require!(args.exposure.len() <= MAX_EXPOSURE_REGIONS, CatBondError::InputTooLong);
    for r in &args.exposure {
        require!(r.region.len() <= MAX_REGION_LEN, CatBondError::InputTooLong);
        require!(r.pct <= 100, CatBondError::InvalidParams);
    }

    // Sanity checks the EVM version left implicit. term_duration > 0 also
    // guards the coupon-vesting division.
    require_keys_neq!(args.company_wallet, Pubkey::default(), CatBondError::ZeroAddress);
    require_keys_neq!(args.company_wallet, ctx.accounts.sponsor.key(), CatBondError::ConflictOfInterest);
    require!(args.coverage_amount > 0, CatBondError::InvalidParams);
    require!(args.min_investment > 0 && args.min_investment <= args.coverage_amount, CatBondError::InvalidParams);
    require!(args.subscription_duration > 0 && args.term_duration > 0, CatBondError::InvalidParams);
    require!(args.coupon_rate_bps as u64 <= math::BPS_DENOMINATOR, CatBondError::InvalidParams);

    let required_coupon_budget = math::required_coupon_budget(args.coverage_amount, args.coupon_rate_bps)?;

    let bond = &mut ctx.accounts.bond;
    bond.set_inner(Bond {
        bond_id: args.bond_id,
        sponsor: ctx.accounts.sponsor.key(),
        company_wallet: args.company_wallet,
        trigger: ctx.accounts.trigger.key(),
        threshold: args.threshold,
        mint: ctx.accounts.mint.key(),
        vault: ctx.accounts.vault.key(),
        coupon_rate_bps: args.coupon_rate_bps,
        coverage_amount: args.coverage_amount,
        min_investment: args.min_investment,
        subscription_duration: args.subscription_duration,
        term_duration: args.term_duration,
        required_coupon_budget,
        seller_name: args.seller_name,
        deal_id: args.deal_id,
        verified: false,
        exposure: args.exposure,
        status: Status::Funding,
        subscription_end: 0,
        active_start: 0,
        maturity: 0,
        settlement_time: 0,
        last_check: LastCheck::default(),
        total_deposited: 0,
        investor_count: 0,
        bump: ctx.bumps.bond,
        vault_bump: ctx.bumps.vault,
    });

    emit!(BondCreated {
        bond: bond.key(),
        sponsor: bond.sponsor,
        trigger: bond.trigger,
        deal_id: bond.deal_id.clone(),
        required_coupon_budget,
    });
    Ok(())
}

// ── fund_coupon_budget ───────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct FundCouponBudget<'info> {
    pub sponsor: Signer<'info>,

    #[account(
        mut,
        has_one = sponsor @ CatBondError::NotSponsor,
        has_one = mint,
        has_one = vault,
    )]
    pub bond: Account<'info, Bond>,

    #[account(mut, token::mint = mint, token::authority = sponsor)]
    pub sponsor_token: Account<'info, TokenAccount>,

    /// Receives the 0.5% origination fee.
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
}

/// Sponsor deposits the coupon budget (+0.5% fee), opening subscription.
pub fn fund_coupon_budget(ctx: Context<FundCouponBudget>) -> Result<()> {
    let a = &ctx.accounts;
    require_status(&a.bond, Status::Funding)?;

    let now = Clock::get()?.unix_timestamp;
    let budget = a.bond.required_coupon_budget;
    let fee = math::origination_fee(budget)?;

    transfer_from_user(&a.token_program, &a.sponsor_token, &a.company_token, &a.mint, &a.sponsor, fee)?;
    transfer_from_user(&a.token_program, &a.sponsor_token, &a.vault, &a.mint, &a.sponsor, budget)?;

    let bond = &mut ctx.accounts.bond;
    bond.subscription_end = now
        .checked_add(bond.subscription_duration)
        .ok_or(CatBondError::MathOverflow)?;
    bond.status = Status::Subscription;

    emit!(SponsorFunded {
        bond: bond.key(),
        principal_amount: budget,
        fee_amount: fee,
        subscription_end: bond.subscription_end,
    });
    Ok(())
}

// ── set_verified ─────────────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct SetVerified<'info> {
    pub company_wallet: Signer<'info>,

    #[account(mut, has_one = company_wallet @ CatBondError::NotCompanyWallet)]
    pub bond: Account<'info, Bond>,
}

/// Grants or revokes the RHODEX verification stamp. Any lifecycle status.
pub fn set_verified(ctx: Context<SetVerified>, verified: bool) -> Result<()> {
    let bond = &mut ctx.accounts.bond;
    bond.verified = verified;
    emit!(SellerVerified { bond: bond.key(), verified });
    Ok(())
}
