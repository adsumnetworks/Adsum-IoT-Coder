import { StringRequest } from "@shared/proto/cline/common"
import { StateServiceClient } from "@/services/grpc-client"

/** Fire a handover with its own mission/payload — one call shape shared by every surface that can
 *  start work on the developer's coding agent (cards, samples, quota card, typed tasks). */
export const handOverCard = (payload: Record<string, unknown>) =>
	StateServiceClient.handoverToAgent(StringRequest.create({ value: JSON.stringify(payload) })).catch(() => {})
