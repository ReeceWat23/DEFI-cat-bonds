//! Shared LiteSVM harness for the cat_bond integration tests.
//!
//! Loads the real SBF build (`target/deploy/cat_bond.so`), so run
//! `anchor build` before `cargo test`. Every test gets a fresh in-process VM
//! with the clock pinned to `T0`, an RDX mint (6 decimals) and funded wallets.
//! Default terms match DEAL 000 / the localnet test deal.
#![allow(dead_code)]

use anchor_lang::{
    error::{ErrorCode as AnchorError, ERROR_CODE_OFFSET},
    prelude::Pubkey,
    solana_program::{
        instruction::Instruction,
        program_option::COption,
        program_pack::Pack,
        system_program,
    },
    AccountDeserialize, InstructionData, ToAccountMetas,
};
use anchor_spl::token::spl_token::{
    state::{Account as SplAccount, AccountState, Mint as SplMint},
    ID as TOKEN_PROGRAM_ID,
};
use cat_bond::{
    error::CatBondError,
    instructions::{CreateBondArgs, CreateTriggerArgs},
    state::{Bond, ExposureRegion, Position, Trigger},
};
use litesvm::LiteSVM;
use solana_account::Account;
use solana_clock::Clock;
use solana_keypair::Keypair;
use solana_signer::Signer;
use solana_transaction::Transaction;
use std::collections::HashMap;

pub const USDC: u64 = 1_000_000; // 6 decimals
pub const DAY: i64 = 86_400;
pub const T0: i64 = 1_800_000_000; // fixed start time for every test
pub const WALLET_RDX: u64 = 100_000_000 * USDC;

/// $B → the on-chain whole-USD scale the UI uses (`trigger_level * 1e9`).
pub const fn usd_b(b: u128) -> u128 {
    b * 1_000_000_000
}

#[derive(Clone)]
pub struct Terms {
    pub coverage: u64,
    pub min_investment: u64,
    pub coupon_bps: u16,
    pub subscription: i64,
    pub term: i64,
    pub threshold: u128,
    pub max_report_age: i64,
}

impl Default for Terms {
    /// DEAL 000: $500k coverage, $50k min, 8% flat, 1-hour window, 3-day term,
    /// $370B economic-loss trigger, 150-day max report age.
    fn default() -> Self {
        Self {
            coverage: 500_000 * USDC,
            min_investment: 50_000 * USDC,
            coupon_bps: 800,
            subscription: 3_600,
            term: 3 * DAY,
            threshold: usd_b(370),
            max_report_age: 150 * DAY,
        }
    }
}

/// A failed transaction: the runtime error (Debug-formatted) plus program logs.
#[derive(Debug)]
pub struct TxFail {
    pub err: String,
    pub logs: Vec<String>,
}
pub type TxResult = Result<(), TxFail>;

pub struct Deal {
    pub svm: LiteSVM,
    pub terms: Terms,
    pub company: Keypair,
    pub sponsor: Keypair,
    pub investors: Vec<Keypair>,
    pub stranger: Keypair,
    pub mint: Pubkey,
    /// wallet → its RDX token account
    pub token: HashMap<Pubkey, Pubkey>,
    pub trigger: Pubkey,
    pub bond: Pubkey,
    pub vault: Pubkey,
    pub bond_id: [u8; 32],
}

impl Deal {
    /// Fresh VM + mint + wallets + trigger + bond (status Funding).
    pub fn new() -> Self {
        Self::with_terms(Terms::default())
    }

    pub fn with_terms(terms: Terms) -> Self {
        let mut d = Self::bare(terms);
        d.create_trigger().expect("create_trigger");
        d.create_bond_with(|_| {}).expect("create_bond");
        d
    }

    /// VM, mint and funded wallets only: no trigger or bond yet.
    pub fn bare(terms: Terms) -> Self {
        let mut svm = LiteSVM::new();
        let so = include_bytes!("../../../../target/deploy/cat_bond.so");
        svm.add_program(cat_bond::ID, so).expect("load cat_bond.so");

        let mut clock: Clock = svm.get_sysvar();
        clock.unix_timestamp = T0;
        svm.set_sysvar(&clock);

        let company = Keypair::new();
        let sponsor = Keypair::new();
        let investors: Vec<Keypair> = (0..3).map(|_| Keypair::new()).collect();
        let stranger = Keypair::new();

        let mint = Pubkey::new_unique();
        let bond_id = [7u8; 32];
        let (bond, _) = Pubkey::find_program_address(&[b"bond", sponsor.pubkey().as_ref(), &bond_id], &cat_bond::ID);
        let (vault, _) = Pubkey::find_program_address(&[b"vault", bond.as_ref()], &cat_bond::ID);
        let (trigger, _) = Pubkey::find_program_address(
            &[b"trigger", company.pubkey().as_ref(), &1u64.to_le_bytes()],
            &cat_bond::ID,
        );

        let mut d = Self {
            svm, terms, company, sponsor, investors, stranger, mint,
            token: HashMap::new(), trigger, bond, vault, bond_id,
        };

        let wallets: Vec<Pubkey> = [&d.company, &d.sponsor, &d.stranger]
            .into_iter()
            .chain(d.investors.iter())
            .map(|k| k.pubkey())
            .collect();
        for w in &wallets {
            d.svm.airdrop(w, 10_000_000_000).expect("airdrop");
        }
        d.put_mint(wallets.len() as u64 * WALLET_RDX);
        for w in wallets {
            let acct = d.put_token_account(w, WALLET_RDX);
            d.token.insert(w, acct);
        }
        d
    }

    // ── Raw account setup (SPL accounts written directly, no token CPIs) ──────

    fn put_mint(&mut self, supply: u64) {
        let mut data = vec![0u8; SplMint::LEN];
        SplMint {
            mint_authority: COption::Some(self.company.pubkey()),
            supply,
            decimals: 6,
            is_initialized: true,
            freeze_authority: COption::None,
        }
        .pack_into_slice(&mut data);
        let lamports = self.svm.minimum_balance_for_rent_exemption(SplMint::LEN);
        self.svm
            .set_account(self.mint, Account { lamports, data, owner: TOKEN_PROGRAM_ID, executable: false, rent_epoch: 0 })
            .expect("set mint");
    }

    /// Creates an RDX token account owned by `owner` holding `amount`.
    pub fn put_token_account(&mut self, owner: Pubkey, amount: u64) -> Pubkey {
        let address = Pubkey::new_unique();
        let mut data = vec![0u8; SplAccount::LEN];
        SplAccount {
            mint: self.mint,
            owner,
            amount,
            delegate: COption::None,
            state: AccountState::Initialized,
            is_native: COption::None,
            delegated_amount: 0,
            close_authority: COption::None,
        }
        .pack_into_slice(&mut data);
        let lamports = self.svm.minimum_balance_for_rent_exemption(SplAccount::LEN);
        self.svm
            .set_account(address, Account { lamports, data, owner: TOKEN_PROGRAM_ID, executable: false, rent_epoch: 0 })
            .expect("set token account");
        address
    }

    // ── Plumbing ───────────────────────────────────────────────────────────────

    /// Sends one instruction, `signer` paying the fee. Expires the blockhash
    /// afterwards so an identical follow-up transaction isn't deduplicated.
    pub fn send(&mut self, ix: Instruction, signer: &Keypair) -> TxResult {
        let tx = Transaction::new_signed_with_payer(&[ix], Some(&signer.pubkey()), &[signer], self.svm.latest_blockhash());
        let res = self.svm.send_transaction(tx);
        self.svm.expire_blockhash();
        res.map(|_| ()).map_err(|f| TxFail { err: format!("{:?}", f.err), logs: f.meta.logs })
    }

    pub fn now(&self) -> i64 {
        self.svm.get_sysvar::<Clock>().unix_timestamp
    }

    pub fn warp(&mut self, seconds: i64) {
        let mut clock: Clock = self.svm.get_sysvar();
        clock.unix_timestamp += seconds;
        clock.slot += 1;
        self.svm.set_sysvar(&clock);
    }

    pub fn investor(&self, i: usize) -> Pubkey {
        self.investors[i].pubkey()
    }

    pub fn token_of(&self, wallet: &Pubkey) -> Pubkey {
        self.token[wallet]
    }

    pub fn balance(&self, wallet: &Pubkey) -> u64 {
        self.amount_in(&self.token_of(wallet))
    }

    pub fn vault_balance(&self) -> u64 {
        self.amount_in(&self.vault)
    }

    fn amount_in(&self, token_account: &Pubkey) -> u64 {
        let acct = self.svm.get_account(token_account).expect("token account exists");
        SplAccount::unpack(&acct.data).expect("unpack token account").amount
    }

    fn read<T: AccountDeserialize>(&self, address: &Pubkey) -> Option<T> {
        let acct = self.svm.get_account(address)?;
        T::try_deserialize(&mut acct.data.as_slice()).ok()
    }

    pub fn bond_state(&self) -> Bond {
        self.read(&self.bond).expect("bond account")
    }

    pub fn trigger_state(&self) -> Trigger {
        self.read(&self.trigger).expect("trigger account")
    }

    pub fn position_pda(&self, investor: &Pubkey) -> Pubkey {
        Pubkey::find_program_address(&[b"position", self.bond.as_ref(), investor.as_ref()], &cat_bond::ID).0
    }

    pub fn position(&self, investor: &Pubkey) -> Option<Position> {
        self.read(&self.position_pda(investor))
    }

    pub fn ix(accounts: impl ToAccountMetas, data: impl InstructionData) -> Instruction {
        Instruction { program_id: cat_bond::ID, accounts: accounts.to_account_metas(None), data: data.data() }
    }

    // ── Instructions ───────────────────────────────────────────────────────────

    pub fn create_trigger(&mut self) -> TxResult {
        let args = CreateTriggerArgs {
            trigger_id: 1,
            reporter: self.company.pubkey(),
            product_id: "natcat_loss".into(),
            version: 3,
            value_path: "[0].economic_loss_b".into(),
            units: "usd_billions".into(),
            max_report_age: self.terms.max_report_age,
            endpoint_hash: [9u8; 32],
        };
        let ix = Self::ix(
            cat_bond::accounts::CreateTrigger { owner: self.company.pubkey(), trigger: self.trigger, system_program: system_program::ID },
            cat_bond::instruction::CreateTrigger { args },
        );
        let company = self.company.insecure_clone();
        self.send(ix, &company)
    }

    /// Default bond args from `terms`, with `edit` applied first (for
    /// invalid-parameter tests).
    pub fn create_bond_with(&mut self, edit: impl FnOnce(&mut CreateBondArgs)) -> TxResult {
        let sponsor = self.sponsor.insecure_clone();
        self.create_bond_by(&sponsor, edit)
    }

    /// Like `create_bond_with`, but `payer` posts the deal (signs + pays rent)
    /// for `self.sponsor`, as an EVM deployer passes `_sponsor`.
    pub fn create_bond_by(&mut self, payer: &Keypair, edit: impl FnOnce(&mut CreateBondArgs)) -> TxResult {
        let t = &self.terms;
        let mut args = CreateBondArgs {
            bond_id: self.bond_id,
            company_wallet: self.company.pubkey(),
            threshold: t.threshold,
            coupon_rate_bps: t.coupon_bps,
            coverage_amount: t.coverage,
            min_investment: t.min_investment,
            subscription_duration: t.subscription,
            term_duration: t.term,
            seller_name: "Raydion".into(),
            deal_id: "DEAL001-test".into(),
            exposure: vec![
                ExposureRegion { region: "US".into(), pct: 50 },
                ExposureRegion { region: "China".into(), pct: 30 },
                ExposureRegion { region: "Brazil".into(), pct: 15 },
                ExposureRegion { region: "EU".into(), pct: 5 },
            ],
        };
        edit(&mut args);
        let ix = Self::ix(
            cat_bond::accounts::CreateBond {
                payer: payer.pubkey(),
                sponsor: self.sponsor.pubkey(),
                trigger: self.trigger,
                mint: self.mint,
                bond: self.bond,
                vault: self.vault,
                token_program: TOKEN_PROGRAM_ID,
                system_program: system_program::ID,
            },
            cat_bond::instruction::CreateBond { args },
        );
        self.send(ix, payer)
    }

    /// `signer` claims to be the sponsor; fees go to the company's token account.
    pub fn fund(&mut self, signer: &Keypair) -> TxResult {
        let company_token = self.token_of(&self.company.pubkey());
        self.fund_with(signer, company_token)
    }

    pub fn fund_with(&mut self, signer: &Keypair, company_token: Pubkey) -> TxResult {
        let ix = Self::ix(
            cat_bond::accounts::FundCouponBudget {
                sponsor: signer.pubkey(),
                bond: self.bond,
                sponsor_token: self.token_of(&signer.pubkey()),
                company_token,
                vault: self.vault,
                mint: self.mint,
                token_program: TOKEN_PROGRAM_ID,
            },
            cat_bond::instruction::FundCouponBudget {},
        );
        self.send(ix, signer)
    }

    pub fn deposit(&mut self, investor: &Keypair, amount: u64, max_accepted: u64) -> TxResult {
        let ix = Self::ix(
            cat_bond::accounts::Deposit {
                investor: investor.pubkey(),
                bond: self.bond,
                position: self.position_pda(&investor.pubkey()),
                investor_token: self.token_of(&investor.pubkey()),
                company_token: self.token_of(&self.company.pubkey()),
                vault: self.vault,
                mint: self.mint,
                token_program: TOKEN_PROGRAM_ID,
                system_program: system_program::ID,
            },
            cat_bond::instruction::Deposit { amount, max_accepted },
        );
        self.send(ix, investor)
    }

    pub fn close_subscription(&mut self, caller: &Keypair) -> TxResult {
        let ix = Self::ix(
            cat_bond::accounts::CloseSubscription {
                caller: caller.pubkey(),
                bond: self.bond,
                trigger: self.trigger,
                vault: self.vault,
                sponsor_token: self.token_of(&self.sponsor.pubkey()),
                mint: self.mint,
                token_program: TOKEN_PROGRAM_ID,
            },
            cat_bond::instruction::CloseSubscription {},
        );
        self.send(ix, caller)
    }

    pub fn payout_accounts(&self, investor: &Keypair, investor_token: Pubkey) -> cat_bond::accounts::InvestorPayout {
        cat_bond::accounts::InvestorPayout {
            investor: investor.pubkey(),
            bond: self.bond,
            position: self.position_pda(&investor.pubkey()),
            vault: self.vault,
            investor_token,
            mint: self.mint,
            token_program: TOKEN_PROGRAM_ID,
        }
    }

    pub fn claim(&mut self, investor: &Keypair) -> TxResult {
        let to = self.token_of(&investor.pubkey());
        self.claim_to(investor, to)
    }

    /// Claim, paying out to an explicit token account (to test redirection).
    pub fn claim_to(&mut self, investor: &Keypair, investor_token: Pubkey) -> TxResult {
        let ix = Self::ix(self.payout_accounts(investor, investor_token), cat_bond::instruction::ClaimCoupon {});
        self.send(ix, investor)
    }

    pub fn withdraw(&mut self, investor: &Keypair) -> TxResult {
        let to = self.token_of(&investor.pubkey());
        let ix = Self::ix(self.payout_accounts(investor, to), cat_bond::instruction::WithdrawPrincipal {});
        self.send(ix, investor)
    }

    /// Appends a report with `value` (whole USD) at the current clock time.
    pub fn post_report(&mut self, reporter: &Keypair, value: u128) -> TxResult {
        let index = self.trigger_state().report_count;
        let (report, _) = Pubkey::find_program_address(
            &[b"report", self.trigger.as_ref(), &index.to_le_bytes()],
            &cat_bond::ID,
        );
        let ix = Self::ix(
            cat_bond::accounts::PostReport { reporter: reporter.pubkey(), trigger: self.trigger, report, system_program: system_program::ID },
            cat_bond::instruction::PostReport { value, monitor_ref: [index as u8; 32] },
        );
        self.send(ix, reporter)
    }

    pub fn set_reporter(&mut self, signer: &Keypair, reporter: Pubkey) -> TxResult {
        let ix = Self::ix(
            cat_bond::accounts::SetReporter { owner: signer.pubkey(), trigger: self.trigger },
            cat_bond::instruction::SetReporter { reporter },
        );
        self.send(ix, signer)
    }

    pub fn check_trigger(&mut self, caller: &Keypair) -> TxResult {
        let ix = Self::ix(
            cat_bond::accounts::CheckTrigger { caller: caller.pubkey(), bond: self.bond, trigger: self.trigger },
            cat_bond::instruction::CheckTrigger {},
        );
        self.send(ix, caller)
    }

    pub fn mark_matured(&mut self, signer: &Keypair) -> TxResult {
        let ix = Self::ix(
            cat_bond::accounts::MarkMatured { company_wallet: signer.pubkey(), bond: self.bond, trigger: self.trigger },
            cat_bond::instruction::MarkMatured {},
        );
        self.send(ix, signer)
    }

    pub fn settle(&mut self, signer: &Keypair) -> TxResult {
        let ix = Self::ix(
            cat_bond::accounts::Settle {
                company_wallet: signer.pubkey(),
                bond: self.bond,
                trigger: self.trigger,
                vault: self.vault,
                sponsor_token: self.token_of(&self.sponsor.pubkey()),
                mint: self.mint,
                token_program: TOKEN_PROGRAM_ID,
            },
            cat_bond::instruction::Settle {},
        );
        self.send(ix, signer)
    }

    pub fn set_verified(&mut self, signer: &Keypair, verified: bool) -> TxResult {
        let ix = Self::ix(
            cat_bond::accounts::SetVerified { company_wallet: signer.pubkey(), bond: self.bond },
            cat_bond::instruction::SetVerified { verified },
        );
        self.send(ix, signer)
    }

    // ── Composite steps ────────────────────────────────────────────────────────

    /// Sponsor funds; `deposits[i]` is investor i's principal; then closes.
    /// Leaves the bond Active at the current clock time.
    pub fn activate(&mut self, deposits: &[u64]) {
        let sponsor = self.sponsor.insecure_clone();
        self.fund(&sponsor).expect("fund");
        for (i, &amount) in deposits.iter().enumerate() {
            let inv = self.investors[i].insecure_clone();
            self.deposit(&inv, amount, amount).expect("deposit");
        }
        if deposits.iter().sum::<u64>() < self.terms.coverage {
            self.warp(self.terms.subscription);
        }
        let stranger = self.stranger.insecure_clone();
        self.close_subscription(&stranger).expect("close_subscription");
    }
}

// ── Assertions ────────────────────────────────────────────────────────────────

/// Expected error code of a cat_bond custom error.
pub fn code(e: CatBondError) -> u32 {
    e as u32 + ERROR_CODE_OFFSET
}

/// Expected error code of an Anchor framework error (constraints, etc.).
pub fn anchor_code(e: AnchorError) -> u32 {
    e as u32
}

/// Asserts the transaction failed with exactly this custom error code.
#[track_caller]
pub fn assert_fails_with(res: TxResult, expected: u32) {
    match res {
        Ok(()) => panic!("expected failure with code {expected}, but the transaction succeeded"),
        Err(f) => {
            let needle = format!("Custom({expected})");
            assert!(
                f.err.contains(&needle),
                "expected {needle}, got {}\nlogs:\n  {}",
                f.err,
                f.logs.join("\n  ")
            );
        }
    }
}

#[track_caller]
pub fn ok(res: TxResult) {
    if let Err(f) = res {
        panic!("transaction failed: {}\nlogs:\n  {}", f.err, f.logs.join("\n  "));
    }
}
