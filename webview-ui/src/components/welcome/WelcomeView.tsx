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
			<div className="h-full px-5 overflow-auto flex flex-col gap-2.5">
				<h2 className="text-lg font-semibold">Welcome to Adsum IoT Coder</h2>
				<div className="flex justify-center my-5">
					<NrfLogo className="size-16" />
				</div>
				<p>
					Adsum IoT Coder – for nRF
					<br />
					AI-powered debugging agent for Nordic nRF Connect SDK.
					<br />
					Configure your LLM provider to get started. Be sure to use a model with high reasoning capabilities.
				</p>

				<div className="mt-4.5">
					<ApiOptions currentMode={mode} showModelOptions={false} />
					<VSCodeButton className="mt-0.75" disabled={disableLetsGoButton} onClick={handleSubmit}>
						Let's go!
					</VSCodeButton>
				</div>
			</div>
		</div>
	)
})

export default WelcomeView
