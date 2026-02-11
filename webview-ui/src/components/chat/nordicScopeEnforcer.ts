/**
 * Nordic Logging Assistant - Scope Enforcement
 *
 * Prevents users from going off-topic within a mode.
 * Returns a rejection message if the user's input is off-topic, or null if allowed.
 */

import type { NordicModeId } from "./nordicModes"

interface ScopeRule {
	offTopicPattern: RegExp
	rejectionMessage: string
}

const SCOPE_RULES: Record<NordicModeId, ScopeRule> = {
	log_generator: {
		offTopicPattern: /\b(build|flash|compile|debug(?:ger)?|optimize|refactor|deploy|test)\b/i,
		rejectionMessage:
			"I only help with adding logging code in this mode. Click 'Analyze Device Logs' if you need to analyze logs, or start a new task for other needs.",
	},
	log_analyzer: {
		offTopicPattern: /\b(generate|create|add|write|insert)\b.*\blog\b/i,
		rejectionMessage:
			"I only help with analyzing device logs in this mode. Click 'Generate Logging Code' if you need to add logs, or start a new task for other needs.",
	},
}

/**
 * Check if a user message is off-topic for the current mode.
 * @returns Rejection message string if off-topic, null if the message is on-topic.
 */
export function enforceScope(mode: NordicModeId | null, userMessage: string): string | null {
	if (!mode) {
		return null
	}

	const rule = SCOPE_RULES[mode]
	if (!rule) {
		return null
	}

	if (rule.offTopicPattern.test(userMessage)) {
		return rule.rejectionMessage
	}

	return null
}
