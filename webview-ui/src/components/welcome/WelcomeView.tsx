import { BooleanRequest } from "@shared/proto/cline/common"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { memo, useEffect, useState } from "react"
import NrfLogo from "@/assets/NrfLogo"
import ApiOptions from "@/components/settings/ApiOptions"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { StateServiceClient } from "@/services/grpc-client"
import { validateApiConfiguration } from "@/utils/validate"

const WelcomeView = memo(() => {
	const { apiConfiguration, mode } = useExtensionState()
	const [apiErrorMessage, setApiErrorMessage] = useState<string | undefined>(undefined)

	const disableLetsGoButton = apiErrorMessage != null

	const handleSubmit = async () => {
		try {
			await StateServiceClient.setWelcomeViewCompleted(BooleanRequest.create({ value: true }))
		} catch (error) {
			console.error("Failed to update API configuration or complete welcome view:", error)
		}
	}

	useEffect(() => {
		setApiErrorMessage(validateApiConfiguration(mode, apiConfiguration))
	}, [apiConfiguration, mode])

	return (
		<div className="fixed inset-0 p-0 flex flex-col">
			<div className="h-full px-5 overflow-y-auto overflow-x-hidden flex flex-col gap-2.5">
				<div className="flex justify-center mt-5 mb-3">
					<NrfLogo className="size-20" />
				</div>
				<div style={{ display: "flex", justifyContent: "center", width: "100%" }}>
					<div className="text-2xl font-bold" style={{ textAlign: "center", maxWidth: "100%" }}>
						Welcome to Adsum IoT Coder – for nRF
					</div>
				</div>
				<p className="mt-4">Configure your API provider below to get started.</p>

				<div>
					<ApiOptions currentMode={mode} showModelOptions={false} />
					<div className="flex justify-center mt-0.75">
						<VSCodeButton disabled={disableLetsGoButton} onClick={handleSubmit}>
							Let's go!
						</VSCodeButton>
					</div>
				</div>
			</div>
		</div>
	)
})

export default WelcomeView
