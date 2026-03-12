import { AlertCircleIcon } from "lucide-react"
import { useCallback, useState } from "react"
import NrfLogo from "@/assets/NrfLogo"
import { Button } from "@/components/ui/button"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { StateServiceClient } from "@/services/grpc-client"
import ApiConfigurationSection from "../settings/sections/ApiConfigurationSection"

const OnboardingView = () => {
	const { hideSettings, hideAccount, setShowWelcome } = useExtensionState()
	const [isActionLoading, setIsActionLoading] = useState(false)

	const handleDone = useCallback(async () => {
		setIsActionLoading(true)
		try {
			await StateServiceClient.setWelcomeViewCompleted({ value: true })
			setShowWelcome(false)
			hideAccount()
			hideSettings()
			StateServiceClient.captureOnboardingProgress({ step: 1, action: "onboarding_completed", completed: true })
		} catch (error) {
			console.error("Failed to complete onboarding:", error)
		} finally {
			setIsActionLoading(false)
		}
	}, [hideAccount, hideSettings, setShowWelcome])

	return (
		<div className="fixed inset-0 p-0 flex flex-col w-full bg-background">
			<div className="h-full px-5 xs:mx-10 overflow-auto flex flex-col gap-4 items-center justify-center">
				<div className="flex flex-col items-center gap-2 flex-shrink-0 mt-8">
					<NrfLogo className="size-24" />
					<h2 className="text-xl font-semibold p-0">Welcome to SoC AI Debugger</h2>
					<p className="text-foreground/70 text-sm text-center max-w-md">
						SoC AI Debugger – for nRF
						<br />
						Your AI-powered Debugger for nRF SoCs.

						<br />
						Configure your API provider below to get started.
					</p>
				</div>

				<div className="flex-1 w-full flex max-w-lg overflow-y-auto min-h-0 py-4">
					<ApiConfigurationSection />
				</div>

				<footer className="flex w-full max-w-lg flex-col gap-3 my-4 px-2 overflow-hidden flex-shrink-0">
					<Button
						className={`w-full rounded-xs ${isActionLoading ? "animate-pulse" : ""}`}
						disabled={isActionLoading}
						onClick={handleDone}
					>
						Done
					</Button>

					<div className="items-center justify-center flex text-sm text-foreground/70 gap-2 mb-3 text-pretty">
						<AlertCircleIcon className="shrink-0 size-3" /> You can change these settings later
					</div>
				</footer>
			</div>
		</div>
	)
}

export default OnboardingView
