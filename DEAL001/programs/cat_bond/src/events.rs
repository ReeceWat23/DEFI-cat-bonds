use anchor_lang::prelude::*;

// ── Bond ──
#[event]
pub struct BondCreated {
    pub bond: Pubkey,
    pub sponsor: Pubkey,
    pub trigger: Pubkey,
    pub deal_id: String,
    pub required_coupon_budget: u64,
}

#[event]
pub struct SponsorFunded {
    pub bond: Pubkey,
    pub principal_amount: u64,
    pub fee_amount: u64,
    pub subscription_end: i64,
}

#[event]
pub struct Deposited {
    pub bond: Pubkey,
    pub investor: Pubkey,
    pub accepted: u64,
    pub fee_amount: u64,
    pub total_deposited: u64,
}

#[event]
pub struct SubscriptionClosed {
    pub bond: Pubkey,
    pub total_deposited: u64,
    pub unused_coupon_refund: u64,
}

#[event]
pub struct CouponClaimed {
    pub bond: Pubkey,
    pub investor: Pubkey,
    pub amount: u64,
}

#[event]
pub struct PrincipalWithdrawn {
    pub bond: Pubkey,
    pub investor: Pubkey,
    pub amount: u64,
}

#[event]
pub struct BondMatured {
    pub bond: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct Settled {
    pub bond: Pubkey,
    pub amount_to_sponsor: u64,
    pub settlement_time: i64,
}

#[event]
pub struct SellerVerified {
    pub bond: Pubkey,
    pub verified: bool,
}

#[event]
pub struct TriggerChecked {
    pub bond: Pubkey,
    pub value: u128,
    pub reported_at: i64,
    pub triggered: bool,
}

// ── Trigger ──
#[event]
pub struct TriggerCreated {
    pub trigger: Pubkey,
    pub owner: Pubkey,
    pub reporter: Pubkey,
    pub product_id: String,
    pub version: u64,
}

#[event]
pub struct ReporterSet {
    pub trigger: Pubkey,
    pub reporter: Pubkey,
}

#[event]
pub struct ReportPosted {
    pub trigger: Pubkey,
    pub index: u64,
    pub value: u128,
    pub reported_at: i64,
    pub reporter: Pubkey,
    pub monitor_ref: [u8; 32],
}
