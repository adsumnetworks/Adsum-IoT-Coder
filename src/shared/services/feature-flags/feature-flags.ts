import type { FeatureFlagPayload } from "@/services/feature-flags/providers/IFeatureFlagsProvider"

export enum FeatureFlag {
	WEBTOOLS = "webtools",
	WORKTREES = "worktree-exp",
	// Feature flag for showing the new onboarding flow or old welcome view.
	ONBOARDING_MODELS = "onboarding_models",
	// Gates Stage 0 free-tier inference (anonymous install quota via Adsum proxy)
	FREE_TIER_STAGE0 = "free-tier-stage0",
	// Gates the one-time "leave a review" welcome nudge. Dark-launched: default OFF so the card never shows
	// until we have seeded a 5-star floor, then flipped on remotely. The completion counter runs regardless,
	// so flipping it on lands on a warm pool of already-eligible users.
	REVIEW_NUDGE = "review-nudge",
}

export const FeatureFlagDefaultValue: Partial<Record<FeatureFlag, FeatureFlagPayload>> = {
	[FeatureFlag.WEBTOOLS]: false,
	[FeatureFlag.WORKTREES]: false,
	[FeatureFlag.ONBOARDING_MODELS]: process.env.E2E_TEST === "true" ? { models: {} } : undefined,
	// Stage 0 free tier is deployed → default ON so a fresh install lands on the free tier with no config needed
	// (until quota is exhausted). Remote config can still set this to false as a kill-switch.
	[FeatureFlag.FREE_TIER_STAGE0]: true,
	// OFF until we choose to launch it — remote flag flips it on. See the enum comment.
	[FeatureFlag.REVIEW_NUDGE]: false,
}

export const FEATURE_FLAGS = Object.values(FeatureFlag)
