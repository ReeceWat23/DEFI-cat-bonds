//! End-to-end lifecycle tests: every token movement is checked to the base
//! unit, so these pin down the economics, not just "it didn't revert".
//!
//! Run from DEAL001/:  anchor build && cargo test

mod common;
use cat_bond::{error::CatBondError, state::Status};
use common::*;
use solana_signer::Signer;

/// Funding → Subscription → Active → Matured, two investors, full subscription.
#[test]
fn happy_path_matures_and_pays_everyone_exactly() {
    let mut d = Deal::new();
    let (sponsor, company, stranger) = (d.sponsor.insecure_clone(), d.company.insecure_clone(), d.stranger.insecure_clone());
    let (inv0, inv1) = (d.investors[0].insecure_clone(), d.investors[1].insecure_clone());
    let (s, c) = (sponsor.pubkey(), company.pubkey());

    assert_eq!(d.bond_state().status, Status::Funding);
    assert_eq!(d.bond_state().required_coupon_budget, 40_000 * USDC); // 8% of $500k

    // ── Fund: sponsor pays budget + 0.5% fee; the fee goes to the company ──
    ok(d.fund(&sponsor));
    assert_eq!(d.balance(&s), WALLET_RDX - 40_200 * USDC);
    assert_eq!(d.balance(&c), WALLET_RDX + 200 * USDC);
    assert_eq!(d.vault_balance(), 40_000 * USDC);
    let b = d.bond_state();
    assert_eq!(b.status, Status::Subscription);
    assert_eq!(b.subscription_end, T0 + 3_600);

    // ── Deposits: principal into the vault, 0.5% fee to the company ──
    ok(d.deposit(&inv0, 300_000 * USDC, 300_000 * USDC));
    ok(d.deposit(&inv1, 200_000 * USDC, 200_000 * USDC));
    assert_eq!(d.balance(&inv0.pubkey()), WALLET_RDX - 301_500 * USDC);
    assert_eq!(d.balance(&inv1.pubkey()), WALLET_RDX - 201_000 * USDC);
    assert_eq!(d.balance(&c), WALLET_RDX + (200 + 1_500 + 1_000) * USDC);
    assert_eq!(d.vault_balance(), 540_000 * USDC);
    let b = d.bond_state();
    assert_eq!(b.total_deposited, 500_000 * USDC);
    assert_eq!(b.investor_count, 2);
    assert_eq!(d.position(&inv0.pubkey()).unwrap().principal, 300_000 * USDC);

    // ── Fully subscribed → anyone may close before the window ends, no refund ──
    ok(d.close_subscription(&stranger));
    let b = d.bond_state();
    assert_eq!(b.status, Status::Active);
    assert_eq!(b.active_start, T0);
    assert_eq!(b.maturity, T0 + 3 * DAY);
    assert_eq!(d.balance(&s), WALLET_RDX - 40_200 * USDC, "no refund when fully subscribed");

    // ── Below-threshold report, then coupon vests per second ──
    ok(d.post_report(&company, usd_b(100)));
    d.warp(3 * DAY / 2);
    ok(d.claim(&inv0));
    assert_eq!(d.position(&inv0.pubkey()).unwrap().claimed, 12_000 * USDC, "half of 8% × $300k");

    // Anyone can refresh the on-chain check; it records but doesn't fire.
    ok(d.check_trigger(&stranger));
    let lc = d.bond_state().last_check;
    assert!(!lc.triggered);
    assert_eq!(lc.value, usd_b(100));
    assert_eq!(lc.checked_by, stranger.pubkey());

    // ── Maturity ──
    d.warp(3 * DAY / 2);
    ok(d.mark_matured(&company));
    assert_eq!(d.bond_state().status, Status::Matured);

    // inv0 claims the remaining 12k after Matured (claim_coupon still works),
    // then withdraws principal only. inv1 never claimed: withdraw pays
    // principal + the full 16k coupon in one transfer.
    d.warp(30 * DAY); // well past maturity: still capped at the full coupon
    ok(d.claim(&inv0));
    assert_eq!(d.position(&inv0.pubkey()).unwrap().claimed, 24_000 * USDC);
    ok(d.withdraw(&inv0));
    assert_eq!(d.balance(&inv0.pubkey()), WALLET_RDX - 1_500 * USDC + 24_000 * USDC);
    ok(d.withdraw(&inv1));
    assert_eq!(d.position(&inv1.pubkey()).unwrap().claimed, 16_000 * USDC);

    // Each investor: lost only the 0.5% fee, gained the full 8% coupon.
    assert_eq!(d.balance(&inv0.pubkey()), WALLET_RDX - 1_500 * USDC + 24_000 * USDC);
    assert_eq!(d.balance(&inv1.pubkey()), WALLET_RDX - 1_000 * USDC + 16_000 * USDC);
    assert_eq!(d.vault_balance(), 0, "budget and principal fully paid out, nothing stranded");

    // ── Nothing can be taken twice ──
    assert_fails_with(d.withdraw(&inv0), code(CatBondError::AlreadyWithdrawn));
    assert_fails_with(d.claim(&inv0), code(CatBondError::NothingToClaim));
    assert_fails_with(d.claim(&inv1), code(CatBondError::NothingToClaim));
}

/// Partly claimed before maturity: withdraw sweeps exactly the rest.
#[test]
fn withdraw_sweeps_remaining_coupon_with_principal() {
    let mut d = Deal::new();
    let (company, inv0) = (d.company.insecure_clone(), d.investors[0].insecure_clone());
    d.activate(&[500_000 * USDC]); // full coverage: $40k coupon over the term
    ok(d.post_report(&company, usd_b(100)));
    d.warp(3 * DAY / 4);
    ok(d.claim(&inv0)); // a quarter: $10k
    let after_claim = d.balance(&inv0.pubkey());

    d.warp(9 * DAY / 4);
    ok(d.post_report(&company, usd_b(100)));
    ok(d.mark_matured(&company));
    ok(d.withdraw(&inv0));
    assert_eq!(d.balance(&inv0.pubkey()) - after_claim, 500_000 * USDC + 30_000 * USDC);
    assert_eq!(d.vault_balance(), 0);
    assert_fails_with(d.claim(&inv0), code(CatBondError::NothingToClaim));
}

/// Trigger fires one day into a three-day term: principal goes to the
/// sponsor, investors keep coupon vested up to settlement and no more.
#[test]
fn trigger_fired_pays_sponsor_and_stops_coupon_at_settlement() {
    let mut d = Deal::new();
    let (sponsor, company, inv0) = (d.sponsor.insecure_clone(), d.company.insecure_clone(), d.investors[0].insecure_clone());
    d.activate(&[500_000 * USDC]);
    let sponsor_before = d.balance(&sponsor.pubkey());

    d.warp(DAY);
    ok(d.post_report(&company, usd_b(400))); // ≥ $370B
    ok(d.settle(&company));

    let b = d.bond_state();
    assert_eq!(b.status, Status::Triggered);
    assert_eq!(b.settlement_time, T0 + DAY);
    assert!(b.last_check.triggered);
    assert_eq!(d.balance(&sponsor.pubkey()), sponsor_before + 500_000 * USDC, "all principal to sponsor");

    // One day of three vested: 40,000 × 1/3, floored to the base unit.
    ok(d.claim(&inv0));
    let vested = 40_000 * USDC / 3;
    assert_eq!(d.position(&inv0.pubkey()).unwrap().claimed, vested);

    // Vesting stopped at settlement.
    d.warp(2 * DAY);
    assert_fails_with(d.claim(&inv0), code(CatBondError::NothingToClaim));
    assert_fails_with(d.withdraw(&inv0), code(CatBondError::WrongStatus));

    // Known gap (same as CatBond.sol): the unvested coupon budget has no
    // exit path after a trigger; it stays in the vault.
    assert_eq!(d.vault_balance(), 40_000 * USDC - vested);
}

/// Exactly at the threshold counts as triggered (`>=`), matching CatBond.sol.
#[test]
fn report_exactly_at_threshold_triggers() {
    let mut d = Deal::new();
    let company = d.company.insecure_clone();
    d.activate(&[500_000 * USDC]);
    ok(d.post_report(&company, usd_b(370)));
    ok(d.settle(&company));
    assert_eq!(d.bond_state().status, Status::Triggered);
}

/// Undersubscribed: the window lapses, and the coupon budget for unsold
/// coverage is refunded to the sponsor at close.
#[test]
fn undersubscription_refunds_unused_coupon_budget() {
    let mut d = Deal::new();
    let (sponsor, company, inv0) = (d.sponsor.insecure_clone(), d.company.insecure_clone(), d.investors[0].insecure_clone());

    d.activate(&[300_000 * USDC]); // $200k of $500k unsold
    // Sponsor paid 40,200, got back 8% of the unsold $200k = 16,000.
    assert_eq!(d.balance(&sponsor.pubkey()), WALLET_RDX - 40_200 * USDC + 16_000 * USDC);
    assert_eq!(d.bond_state().active_start, T0 + 3_600);
    assert_eq!(d.vault_balance(), 300_000 * USDC + 24_000 * USDC);

    // The remaining budget exactly covers the sold coverage's coupon.
    d.warp(3 * DAY);
    ok(d.post_report(&company, usd_b(100)));
    ok(d.mark_matured(&company));
    ok(d.claim(&inv0));
    ok(d.withdraw(&inv0));
    assert_eq!(d.vault_balance(), 0);
}

/// A second deposit from the same investor adds to their position rather
/// than creating a new one, and only counts them once.
#[test]
fn repeat_deposits_accumulate_in_one_position() {
    let mut d = Deal::new();
    let (sponsor, inv0) = (d.sponsor.insecure_clone(), d.investors[0].insecure_clone());
    ok(d.fund(&sponsor));
    ok(d.deposit(&inv0, 100_000 * USDC, 100_000 * USDC));
    ok(d.deposit(&inv0, 50_000 * USDC, 50_000 * USDC));
    assert_eq!(d.position(&inv0.pubkey()).unwrap().principal, 150_000 * USDC);
    assert_eq!(d.bond_state().investor_count, 1);
}

/// The RHODEX verification stamp: company wallet only, any status.
#[test]
fn verification_stamp_is_company_only() {
    let mut d = Deal::new();
    let (company, stranger) = (d.company.insecure_clone(), d.stranger.insecure_clone());
    assert!(!d.bond_state().verified);
    assert_fails_with(d.set_verified(&stranger, true), code(CatBondError::NotCompanyWallet));
    ok(d.set_verified(&company, true));
    assert!(d.bond_state().verified);
    ok(d.set_verified(&company, false));
    assert!(!d.bond_state().verified);
}
