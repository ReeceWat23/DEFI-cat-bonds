//! Every guard the program relies on, each asserted against its exact error
//! code: wrong signers, wrong lifecycle state, investment rules, stale or
//! missing reports, and attempts to redirect funds.

mod common;
use anchor_lang::error::ErrorCode as AnchorError;
use cat_bond::{error::CatBondError, state::Status};
use common::*;
use solana_signer::Signer;

// ── Signers / roles ───────────────────────────────────────────────────────────

#[test]
fn only_the_sponsor_can_fund() {
    let mut d = Deal::new();
    let (stranger, inv0) = (d.stranger.insecure_clone(), d.investors[0].insecure_clone());
    assert_fails_with(d.fund(&stranger), code(CatBondError::NotSponsor));
    assert_fails_with(d.fund(&inv0), code(CatBondError::NotSponsor));
}

/// EVM parity: anyone can post a deal naming a sponsor (the constructor's
/// `_sponsor` is just an address); only that sponsor can then fund it.
#[test]
fn anyone_can_post_a_bond_for_a_sponsor_but_only_the_sponsor_funds_it() {
    let mut d = Deal::bare(Terms::default());
    ok(d.create_trigger());
    let (stranger, sponsor) = (d.stranger.insecure_clone(), d.sponsor.insecure_clone());

    ok(d.create_bond_by(&stranger, |_| {}));
    let b = d.bond_state();
    assert_eq!(b.sponsor, sponsor.pubkey());
    assert_eq!(b.status, Status::Funding);

    assert_fails_with(d.fund(&stranger), code(CatBondError::NotSponsor));
    ok(d.fund(&sponsor));
    assert_eq!(d.bond_state().status, Status::Subscription);
}

#[test]
fn only_the_company_can_settle_or_mature() {
    let mut d = Deal::new();
    let (sponsor, company, stranger) = (d.sponsor.insecure_clone(), d.company.insecure_clone(), d.stranger.insecure_clone());
    d.activate(&[500_000 * USDC]);
    ok(d.post_report(&company, usd_b(400)));
    assert_fails_with(d.settle(&stranger), code(CatBondError::NotCompanyWallet));
    assert_fails_with(d.settle(&sponsor), code(CatBondError::NotCompanyWallet));
    d.warp(3 * DAY);
    assert_fails_with(d.mark_matured(&stranger), code(CatBondError::NotCompanyWallet));
    assert_fails_with(d.mark_matured(&sponsor), code(CatBondError::NotCompanyWallet));
}

#[test]
fn only_the_reporter_can_post_and_only_the_owner_can_change_reporter() {
    let mut d = Deal::new();
    let (company, stranger) = (d.company.insecure_clone(), d.stranger.insecure_clone());
    assert_fails_with(d.post_report(&stranger, usd_b(400)), code(CatBondError::NotReporter));
    assert_fails_with(d.set_reporter(&stranger, stranger.pubkey()), code(CatBondError::NotOwner));

    // The owner can hand reporting to someone else (e.g. an oracle network)…
    ok(d.set_reporter(&company, stranger.pubkey()));
    ok(d.post_report(&stranger, usd_b(100)));
    // …after which the old reporter can't post.
    assert_fails_with(d.post_report(&company, usd_b(100)), code(CatBondError::NotReporter));
    assert_eq!(d.trigger_state().report_count, 1);
}

#[test]
fn sponsor_and_company_cannot_invest_in_their_own_bond() {
    let mut d = Deal::new();
    let (sponsor, company) = (d.sponsor.insecure_clone(), d.company.insecure_clone());
    ok(d.fund(&sponsor));
    assert_fails_with(d.deposit(&sponsor, 100_000 * USDC, 100_000 * USDC), code(CatBondError::ConflictOfInterest));

    // The company's usual token account is also the fee destination, so
    // Anchor already refuses it as a duplicate writable account…
    assert_fails_with(
        d.deposit(&company, 100_000 * USDC, 100_000 * USDC),
        anchor_code(AnchorError::ConstraintDuplicateMutableAccount),
    );
    // …and from a second token account it hits the program's own check.
    let second = d.put_token_account(company.pubkey(), 1_000_000 * USDC);
    let ix = Deal::ix(
        cat_bond::accounts::Deposit {
            investor: company.pubkey(),
            bond: d.bond,
            position: d.position_pda(&company.pubkey()),
            investor_token: second,
            company_token: d.token_of(&company.pubkey()),
            vault: d.vault,
            mint: d.mint,
            token_program: anchor_spl::token::ID,
            system_program: anchor_lang::solana_program::system_program::ID,
        },
        cat_bond::instruction::Deposit { amount: 100_000 * USDC, max_accepted: 100_000 * USDC },
    );
    assert_fails_with(d.send(ix, &company), code(CatBondError::ConflictOfInterest));
}

// ── Lifecycle order ───────────────────────────────────────────────────────────

#[test]
fn steps_out_of_order_are_rejected() {
    let mut d = Deal::new();
    let (sponsor, company, stranger, inv0) =
        (d.sponsor.insecure_clone(), d.company.insecure_clone(), d.stranger.insecure_clone(), d.investors[0].insecure_clone());

    assert_fails_with(d.deposit(&inv0, 100_000 * USDC, 100_000 * USDC), code(CatBondError::WrongStatus)); // not funded yet
    assert_fails_with(d.close_subscription(&stranger), code(CatBondError::WrongStatus));
    ok(d.fund(&sponsor));
    assert_fails_with(d.fund(&sponsor), code(CatBondError::WrongStatus)); // can't fund twice
    assert_fails_with(d.settle(&company), code(CatBondError::WrongStatus)); // not Active
    assert_fails_with(d.mark_matured(&company), code(CatBondError::WrongStatus));
    ok(d.deposit(&inv0, 500_000 * USDC, 500_000 * USDC));
    assert_fails_with(d.withdraw(&inv0), code(CatBondError::WrongStatus)); // not Matured
    assert_fails_with(d.claim(&inv0), code(CatBondError::WrongStatus)); // not Active yet
}

#[test]
fn subscription_cannot_close_early_unless_fully_subscribed() {
    let mut d = Deal::new();
    let (sponsor, stranger, inv0) = (d.sponsor.insecure_clone(), d.stranger.insecure_clone(), d.investors[0].insecure_clone());
    ok(d.fund(&sponsor));
    ok(d.deposit(&inv0, 300_000 * USDC, 300_000 * USDC));
    assert_fails_with(d.close_subscription(&stranger), code(CatBondError::SubscriptionStillOpen));
    d.warp(3_600);
    ok(d.close_subscription(&stranger));
}

#[test]
fn deposits_are_rejected_after_the_window() {
    let mut d = Deal::new();
    let (sponsor, inv0) = (d.sponsor.insecure_clone(), d.investors[0].insecure_clone());
    ok(d.fund(&sponsor));
    d.warp(3_600); // exactly at subscription_end: already closed
    assert_fails_with(d.deposit(&inv0, 100_000 * USDC, 100_000 * USDC), code(CatBondError::SubscriptionExpired));
}

#[test]
fn maturity_cannot_be_marked_early() {
    let mut d = Deal::new();
    let company = d.company.insecure_clone();
    d.activate(&[500_000 * USDC]);
    ok(d.post_report(&company, usd_b(100)));
    d.warp(3 * DAY - 1);
    assert_fails_with(d.mark_matured(&company), code(CatBondError::NotYetMatured));
    d.warp(1);
    ok(d.mark_matured(&company));
}

// ── Investment rules ──────────────────────────────────────────────────────────

#[test]
fn deposits_below_the_minimum_are_rejected() {
    let mut d = Deal::new();
    let (sponsor, inv0) = (d.sponsor.insecure_clone(), d.investors[0].insecure_clone());
    ok(d.fund(&sponsor));
    let just_under = 50_000 * USDC - 1;
    assert_fails_with(d.deposit(&inv0, just_under, just_under), code(CatBondError::BelowMinInvestment));
    ok(d.deposit(&inv0, 50_000 * USDC, 50_000 * USDC));
}

#[test]
fn partial_fill_is_capped_and_guarded_by_max_accepted() {
    let mut d = Deal::new();
    let (sponsor, inv0, inv1) = (d.sponsor.insecure_clone(), d.investors[0].insecure_clone(), d.investors[1].insecure_clone());
    ok(d.fund(&sponsor));
    ok(d.deposit(&inv0, 440_000 * USDC, 440_000 * USDC)); // $60k left

    // Asks for $100k but will only accept $50k: the $60k fill exceeds that.
    assert_fails_with(d.deposit(&inv1, 100_000 * USDC, 50_000 * USDC), code(CatBondError::ExceedsMaxAccepted));

    // Accepts up to $100k: filled at the $60k remaining, charged only for that.
    ok(d.deposit(&inv1, 100_000 * USDC, 100_000 * USDC));
    assert_eq!(d.position(&inv1.pubkey()).unwrap().principal, 60_000 * USDC);
    assert_eq!(d.balance(&inv1.pubkey()), WALLET_RDX - 60_300 * USDC);
    assert_eq!(d.bond_state().total_deposited, 500_000 * USDC);
}

// ── Trigger reports ───────────────────────────────────────────────────────────

#[test]
fn settle_needs_a_fresh_report_from_after_commencement_at_or_above_threshold() {
    let mut d = Deal::new();
    let (sponsor, company, stranger, inv0) =
        (d.sponsor.insecure_clone(), d.company.insecure_clone(), d.stranger.insecure_clone(), d.investors[0].insecure_clone());
    ok(d.fund(&sponsor));
    ok(d.deposit(&inv0, 500_000 * USDC, 500_000 * USDC));

    // No report at all.
    d.warp(1);
    ok(d.close_subscription(&stranger));
    assert_fails_with(d.settle(&company), code(CatBondError::NoReports));

    // A report from before commencement doesn't count…
    let mut d2 = Deal::new();
    let (sponsor2, company2, stranger2, inv02) =
        (d2.sponsor.insecure_clone(), d2.company.insecure_clone(), d2.stranger.insecure_clone(), d2.investors[0].insecure_clone());
    ok(d2.fund(&sponsor2));
    ok(d2.deposit(&inv02, 500_000 * USDC, 500_000 * USDC));
    ok(d2.post_report(&company2, usd_b(100)));
    d2.warp(1);
    ok(d2.close_subscription(&stranger2));
    assert_fails_with(d2.settle(&company2), code(CatBondError::NoReports));

    // …a below-threshold one doesn't fire…
    ok(d.post_report(&company, usd_b(369)));
    assert_fails_with(d.settle(&company), code(CatBondError::TriggerNotFired));

    // …and a qualifying one that has gone stale can't be used either.
    ok(d.post_report(&company, usd_b(400)));
    d.warp(150 * DAY + 1);
    assert_fails_with(d.settle(&company), code(CatBondError::StaleReport));
    assert_eq!(d.bond_state().status, Status::Active);
}

#[test]
fn maturity_is_blocked_by_a_fired_stale_or_missing_report() {
    let mut d = Deal::new();
    let company = d.company.insecure_clone();
    d.activate(&[500_000 * USDC]);
    d.warp(3 * DAY);
    assert_fails_with(d.mark_matured(&company), code(CatBondError::NoReports));

    ok(d.post_report(&company, usd_b(400)));
    assert_fails_with(d.mark_matured(&company), code(CatBondError::TriggerAlreadyFired));

    ok(d.post_report(&company, usd_b(100)));
    d.warp(150 * DAY + 1);
    assert_fails_with(d.mark_matured(&company), code(CatBondError::StaleReport));
}

#[test]
fn subscription_cannot_close_once_the_trigger_has_already_fired() {
    let mut d = Deal::new();
    let (sponsor, company, stranger, inv0) =
        (d.sponsor.insecure_clone(), d.company.insecure_clone(), d.stranger.insecure_clone(), d.investors[0].insecure_clone());
    ok(d.fund(&sponsor));
    ok(d.deposit(&inv0, 500_000 * USDC, 500_000 * USDC));
    ok(d.post_report(&company, usd_b(400)));
    assert_fails_with(d.close_subscription(&stranger), code(CatBondError::TriggerAlreadyFired));
}

// ── Funds can't be redirected ─────────────────────────────────────────────────

#[test]
fn origination_fee_must_go_to_the_company() {
    let mut d = Deal::new();
    let (sponsor, stranger) = (d.sponsor.insecure_clone(), d.stranger.insecure_clone());
    let strangers_account = d.token_of(&stranger.pubkey());
    assert_fails_with(d.fund_with(&sponsor, strangers_account), code(CatBondError::WrongTokenOwner));
}

#[test]
fn payouts_cannot_be_sent_to_someone_elses_token_account() {
    let mut d = Deal::new();
    let (stranger, inv0) = (d.stranger.insecure_clone(), d.investors[0].insecure_clone());
    d.activate(&[500_000 * USDC]);
    d.warp(DAY);
    let strangers_account = d.token_of(&stranger.pubkey());
    assert_fails_with(d.claim_to(&inv0, strangers_account), anchor_code(AnchorError::ConstraintTokenOwner));
}

#[test]
fn a_fake_vault_is_rejected() {
    let mut d = Deal::new();
    let inv0 = d.investors[0].insecure_clone();
    d.activate(&[500_000 * USDC]);
    d.warp(DAY);
    // A token account the attacker controls, posing as the bond's vault.
    let fake_vault = d.put_token_account(inv0.pubkey(), 1_000_000 * USDC);
    let mut accounts = d.payout_accounts(&inv0, d.token_of(&inv0.pubkey()));
    accounts.vault = fake_vault;
    let ix = Deal::ix(accounts, cat_bond::instruction::ClaimCoupon {});
    assert_fails_with(d.send(ix, &inv0), anchor_code(AnchorError::ConstraintHasOne));
}

#[test]
fn someone_without_a_position_cannot_claim() {
    let mut d = Deal::new();
    let stranger = d.stranger.insecure_clone();
    d.activate(&[500_000 * USDC]);
    d.warp(DAY);
    assert_fails_with(d.claim(&stranger), anchor_code(AnchorError::AccountNotInitialized));
}

// ── Bond creation parameters ──────────────────────────────────────────────────

#[test]
fn invalid_bond_parameters_are_rejected() {
    let mut d = Deal::bare(Terms::default());
    ok(d.create_trigger());
    let sponsor = d.sponsor.pubkey();

    assert_fails_with(d.create_bond_with(|a| a.term_duration = 0), code(CatBondError::InvalidParams));
    assert_fails_with(d.create_bond_with(|a| a.subscription_duration = -1), code(CatBondError::InvalidParams));
    assert_fails_with(d.create_bond_with(|a| a.coverage_amount = 0), code(CatBondError::InvalidParams));
    assert_fails_with(d.create_bond_with(|a| a.min_investment = a.coverage_amount + 1), code(CatBondError::InvalidParams));
    assert_fails_with(d.create_bond_with(|a| a.coupon_rate_bps = 10_001), code(CatBondError::InvalidParams));
    assert_fails_with(d.create_bond_with(move |a| a.company_wallet = sponsor), code(CatBondError::ConflictOfInterest));
    assert_fails_with(d.create_bond_with(|a| a.seller_name = "x".repeat(65)), code(CatBondError::InputTooLong));
    assert_fails_with(d.create_bond_with(|a| a.exposure[0].pct = 101), code(CatBondError::InvalidParams));

    // None of the failures left anything behind: a valid bond can still be created at that address.
    ok(d.create_bond_with(|_| {}));
    assert_eq!(d.bond_state().status, Status::Funding);
}
