use anchor_lang::prelude::*;

// ── PDA seeds ────────────────────────────────────────────────────────────────
pub const TRIGGER_SEED: &[u8] = b"trigger";
pub const REPORT_SEED: &[u8] = b"report";
pub const BOND_SEED: &[u8] = b"bond";
pub const VAULT_SEED: &[u8] = b"vault";
pub const POSITION_SEED: &[u8] = b"position";

// ── String / vec limits (on-chain space is pre-allocated) ────────────────────
pub const MAX_PRODUCT_ID_LEN: usize = 32;
pub const MAX_VALUE_PATH_LEN: usize = 64;
pub const MAX_UNITS_LEN: usize = 16;
pub const MAX_SELLER_NAME_LEN: usize = 64;
pub const MAX_DEAL_ID_LEN: usize = 64;
pub const MAX_REGION_LEN: usize = 8;
pub const MAX_EXPOSURE_REGIONS: usize = 16;

// ═════════════════════════════════════════════════════════════════════════════
// Trigger — port of TriggerBase.sol
// ═════════════════════════════════════════════════════════════════════════════

/// One posted report. Mirrors `ITrigger.Report`. `monitor_ref` ties the report
/// back to the off-chain monitor-buffer entry it was derived from.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub struct ReportData {
    /// u128 rather than u64: the UI scales the trigger level by 1e9, which
    /// overflows u64 above ~$18.4B. Solidity used uint256.
    pub value: u128,
    pub reported_at: i64,
    pub reporter: Pubkey,
    pub monitor_ref: [u8; 32],
}

/// Append-only report log tied to a frozen product-definition snapshot.
/// The trigger holds no threshold: each bond compares the latest report
/// against its own threshold, which lets many bonds share one trigger.
///
/// PDA: ["trigger", owner, trigger_id (u64 LE)]
#[account]
#[derive(InitSpace)]
pub struct Trigger {
    pub owner: Pubkey,
    pub reporter: Pubkey,
    pub trigger_id: u64,

    // ProductConfig snapshot (frozen at creation)
    #[max_len(MAX_PRODUCT_ID_LEN)]
    pub product_id: String,
    pub version: u64,
    #[max_len(MAX_VALUE_PATH_LEN)]
    pub value_path: String,
    #[max_len(MAX_UNITS_LEN)]
    pub units: String,
    /// Seconds; a report older than this can't settle or mature a bond.
    pub max_report_age: i64,
    /// Hash of the product endpoint URL, computed off-chain (sha256 of the
    /// UTF-8 URL). The EVM version hashed on-chain with keccak256.
    pub endpoint_hash: [u8; 32],

    /// Number of reports ever posted. Also the index of the next Report PDA.
    pub report_count: u64,
    /// Copy of the most recent report, so bonds can read it without
    /// being handed the Report PDA. Full history lives in Report PDAs.
    pub latest: Option<ReportData>,

    pub bump: u8,
}

/// One entry in the trigger's history.
/// PDA: ["report", trigger, index (u64 LE)]
#[account]
#[derive(InitSpace)]
pub struct Report {
    pub trigger: Pubkey,
    pub index: u64,
    pub data: ReportData,
    pub bump: u8,
}

// ═════════════════════════════════════════════════════════════════════════════
// Bond — port of CatBond.sol
// ═════════════════════════════════════════════════════════════════════════════

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum Status {
    Funding,
    Subscription,
    Active,
    Matured,
    Triggered,
}

/// Mirrors the workshop's SOV region breakdown, e.g. {region: "US", pct: 72}.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq, Debug, InitSpace)]
pub struct ExposureRegion {
    #[max_len(MAX_REGION_LEN)]
    pub region: String,
    /// Percentage points, 0–100.
    pub pct: u8,
}

/// Written by every trigger check. `checked_by` is whoever ran the check,
/// not necessarily the reporter.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, Default, InitSpace)]
pub struct LastCheck {
    pub value: u128,
    pub reported_at: i64,
    pub triggered: bool,
    pub checked_at: i64,
    pub checked_by: Pubkey,
}

/// PDA: ["bond", payer, bond_id]
/// `bond_id` is a 32-byte client-chosen seed; the UI uses sha256(dealId).
/// The address comes from whoever posted the deal (`payer`), like an EVM
/// contract address comes from its deployer: nobody else can claim it in
/// advance by naming the sponsor, which is just an address here.
#[account]
#[derive(InitSpace)]
pub struct Bond {
    pub bond_id: [u8; 32],
    /// Who posted the deal; one of the PDA seeds. Holds no rights over the bond.
    pub payer: Pubkey,

    // ── Immutable configuration ──
    pub sponsor: Pubkey,
    pub company_wallet: Pubkey,
    pub trigger: Pubkey,
    /// This bond's own trigger threshold (same units as trigger reports).
    pub threshold: u128,
    pub mint: Pubkey,
    pub vault: Pubkey,
    pub coupon_rate_bps: u16,
    pub coverage_amount: u64,
    pub min_investment: u64,
    pub subscription_duration: i64,
    pub term_duration: i64,
    pub required_coupon_budget: u64,

    // ── Seller info ──
    #[max_len(MAX_SELLER_NAME_LEN)]
    pub seller_name: String,
    #[max_len(MAX_DEAL_ID_LEN)]
    pub deal_id: String,
    pub verified: bool,
    #[max_len(MAX_EXPOSURE_REGIONS)]
    pub exposure: Vec<ExposureRegion>,

    // ── Lifecycle ──
    pub status: Status,
    pub subscription_end: i64,
    /// Also this bond's commencement — the earliest a report may date from.
    pub active_start: i64,
    pub maturity: i64,
    pub settlement_time: i64,
    pub last_check: LastCheck,

    // ── Accounting ──
    pub total_deposited: u64,
    pub investor_count: u32,

    pub bump: u8,
    pub vault_bump: u8,
}

/// Per-investor accounting — replaces the principalOf / alreadyClaimed /
/// principalWithdrawn mappings.
/// PDA: ["position", bond, investor]
#[account]
#[derive(InitSpace)]
pub struct Position {
    pub bond: Pubkey,
    pub investor: Pubkey,
    pub principal: u64,
    pub claimed: u64,
    pub withdrawn: bool,
    pub bump: u8,
}
