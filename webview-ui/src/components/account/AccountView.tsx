import { memo } from "react"

const AccountView = ({ onDone }: { onDone: () => void }) => {
	return null
}

export default memo(AccountView)

/*
import type { UsageTransaction as ClineAccountUsageTransaction, PaymentTransaction } from "@shared/ClineAccount"
import { isClineInternalTester } from "@shared/internal/account"
import type { UserOrganization } from "@shared/proto/cline/account"
... (rest of original file content commented out)
*/
