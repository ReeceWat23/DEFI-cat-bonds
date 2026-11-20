//! Pure bond math, kept free of account types so it can be unit-tested on the
//! host. All intermediates are u128 (Solidity used uint256); every function
//! rounds down exactly like the EVM version's integer division.

use crate::error::CatBondError;
use anchor_lang::prelude::*;

pub const ORIGINATION_FEE_BPS: u64 = 50; // 0.5%
pub const BPS_DENOMINATOR: u64 = 10_000;

fn to_u64(x: u128) -> Result<u64> {
    u64::try_from(x).map_err(|_| error!(CatBondError::MathOverflow))
}

/// `amount * bps / 10_000`, rounded down.
pub fn bps_of(amount: u64, bps: u64) -> Result<u64> {
    to_u64((amount as u128) * (bps as u128) / (BPS_DENOMINATOR as u128))
}

/// Origination fee charged on top of every sponsor/investor deposit.
pub fn origination_fee(amount: u64) -> Result<u64> {
    bps_of(amount, ORIGINATION_FEE_BPS)
}

/// Flat coupon on full coverage — what the sponsor must fund up front.
pub fn required_coupon_budget(coverage: u64, coupon_rate_bps: u16) -> Result<u64> {
    bps_of(coverage, coupon_rate_bps as u64)
}

/// Coupon budget returned to the sponsor for coverage that went unsold.
pub fn undersubscription_refund(coverage: u64, total_deposited: u64, coupon_rate_bps: u16) -> Result<u64> {
    let unused = coverage.saturating_sub(total_deposited);
    bps_of(unused, coupon_rate_bps as u64)
}

/// Coupon vested to an investor after `elapsed` of `term` seconds.
/// Matches Solidity: `(principal * bps / 10_000) * elapsed / term`, i.e. the
/// total coupon is floored first, then vested linearly.
pub fn vested_coupon(principal: u64, coupon_rate_bps: u16, elapsed: i64, term: i64) -> Result<u64> {
    require!(term > 0, CatBondError::InvalidParams);
    let elapsed = elapsed.clamp(0, term) as u128;
    let total = bps_of(principal, coupon_rate_bps as u64)? as u128;
    to_u64(total * elapsed / term as u128)
}

#[cfg(test)]
mod tests {
    use super::*;

    const USDC: u64 = 1_000_000;

    #[test]
    fn fee_is_exact_half_percent() {
        assert_eq!(origination_fee(40_000 * USDC).unwrap(), 200 * USDC);
        assert_eq!(origination_fee(500_000 * USDC).unwrap(), 2_500 * USDC);
        // Fuzz-style sweep (port of testFuzz_FeeIsExactHalfPercent)
        let mut p: u64 = 1;
        while p < 1_000_000_000 * USDC {
            assert_eq!(origination_fee(p).unwrap(), p / 200);
            p = p * 3 + 7;
        }
    }

    #[test]
    fn deal000_coupon_budget() {
        // DEAL 000: $500k coverage at 800 bps → $40k budget
        assert_eq!(required_coupon_budget(500_000 * USDC, 800).unwrap(), 40_000 * USDC);
    }

    #[test]
    fn undersubscription_refund_matches_unused_coverage() {
        let r = undersubscription_refund(500_000 * USDC, 300_000 * USDC, 800).unwrap();
        assert_eq!(r, 16_000 * USDC);
        assert_eq!(undersubscription_refund(500_000 * USDC, 500_000 * USDC, 800).unwrap(), 0);
    }

    #[test]
    fn half_vesting_at_half_term() {
        let term = 3 * 86_400;
        let v = vested_coupon(100_000 * USDC, 800, term / 2, term).unwrap();
        assert_eq!(v, 4_000 * USDC);
    }

    #[test]
    fn vesting_clamps_at_term_and_zero() {
        let term = 1_000;
        let full = vested_coupon(100_000 * USDC, 800, term, term).unwrap();
        assert_eq!(vested_coupon(100_000 * USDC, 800, term * 10, term).unwrap(), full);
        assert_eq!(vested_coupon(100_000 * USDC, 800, -5, term).unwrap(), 0);
    }

    #[test]
    fn coupon_never_exceeds_cap() {
        // Port of testFuzz_CouponNeverExceedsCap / TwoClaimsSumToAtMostFullCoupon
        let term: i64 = 3 * 86_400;
        let mut principal: u64 = 50_000 * USDC;
        while principal <= 1_000_000_000 * USDC {
            let cap = bps_of(principal, 800).unwrap();
            let mut prev = 0;
            for t in (0..=term * 2).step_by(7_919) {
                let v = vested_coupon(principal, 800, t, term).unwrap();
                assert!(v <= cap);
                assert!(v >= prev, "vesting must be monotonic");
                prev = v;
            }
            principal = principal * 7 + 13;
        }
    }

    #[test]
    fn zero_term_rejected() {
        assert!(vested_coupon(1, 800, 0, 0).is_err());
    }
}
