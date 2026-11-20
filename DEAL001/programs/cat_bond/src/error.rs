use anchor_lang::prelude::*;

#[error_code]
pub enum CatBondError {
    // ── Bond (CatBond.sol) ──
    #[msg("Signer is not the bond sponsor")]
    NotSponsor,
    #[msg("Signer is not the company wallet")]
    NotCompanyWallet,
    #[msg("Bond is in the wrong lifecycle status for this instruction")]
    WrongStatus,
    #[msg("Subscription window is still open and the bond is not fully subscribed")]
    SubscriptionStillOpen,
    #[msg("Subscription window has closed")]
    SubscriptionExpired,
    #[msg("Accepted amount is below the minimum investment")]
    BelowMinInvestment,
    #[msg("Accepted amount exceeds the investor's max_accepted")]
    ExceedsMaxAccepted,
    #[msg("Nothing to claim")]
    NothingToClaim,
    #[msg("Principal already withdrawn")]
    AlreadyWithdrawn,
    #[msg("Trigger has not fired")]
    TriggerNotFired,
    #[msg("Trigger has already fired")]
    TriggerAlreadyFired,
    #[msg("Signer has no position in this bond")]
    NotInvestor,
    #[msg("Bond has not reached maturity")]
    NotYetMatured,
    #[msg("Sponsor and company wallet may not invest in their own bond")]
    ConflictOfInterest,
    #[msg("Latest report is older than the trigger's max report age")]
    StaleReport,

    // ── Trigger (TriggerBase.sol) ──
    #[msg("Signer is not the trigger owner")]
    NotOwner,
    #[msg("Signer is not the trigger reporter")]
    NotReporter,
    #[msg("Address may not be the default (zero) pubkey")]
    ZeroAddress,
    #[msg("No report in the required window")]
    NoReports,

    // ── Solana-specific input validation ──
    #[msg("String or list exceeds its on-chain size limit")]
    InputTooLong,
    #[msg("Invalid bond parameters")]
    InvalidParams,
    #[msg("Token account does not belong to the expected owner")]
    WrongTokenOwner,
    #[msg("Arithmetic overflow")]
    MathOverflow,
}
